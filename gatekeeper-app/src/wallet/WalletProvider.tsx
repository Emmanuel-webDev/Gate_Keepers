import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

/**
 * Real wallets only, through Solana Mobile Wallet Adapter (Seeker Seed Vault, Phantom, Solflare...).
 * MWA is native code, so this needs the installed dev/preview build, not Expo Go.
 */
type WalletCtx = {
  ready: boolean;
  publicKey: PublicKey | null;
  walletName: string;
  supported: boolean; // false in Expo Go / non-Android
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
  signTransactions: (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;
};

const Ctx = createContext<WalletCtx>(null as any);
export const useWallet = () => useContext(Ctx);

const K_MWA = 'gk.mwa'; // { authToken, address(base64) }
const IDENTITY = { name: 'GateKeeper', uri: 'https://gatekeeper.app', icon: 'favicon.ico' };
const CHAIN = 'solana:devnet';

const supported = Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

// required lazily so Expo Go never loads the native module
const mwa = () => require('@solana-mobile/mobile-wallet-adapter-protocol-web3js') as {
  transact: <T>(fn: (w: any) => Promise<T>) => Promise<T>;
};

/** Wallet apps don't report a name, but most give a wallet_uri_base like https://solflare.com/ul/v1 */
function nameFrom(uri?: string): string | undefined {
  const host = uri?.match(/^https?:\/\/(?:www\.)?([^./]+)/i)?.[1];
  return host ? host.charAt(0).toUpperCase() + host.slice(1) : undefined;
}

type Auth = { authToken: string; address: string; label?: string };

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [auth, setAuth] = useState<Auth | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = supported ? await SecureStore.getItemAsync(K_MWA) : null;
        if (raw) setAuth(JSON.parse(raw));
      } finally { setReady(true); }
    })();
  }, []);

  const publicKey = useMemo(() => (auth ? new PublicKey(Buffer.from(auth.address, 'base64')) : null), [auth]);

  const save = async (a: Auth) => { setAuth(a); await SecureStore.setItemAsync(K_MWA, JSON.stringify(a)); };

  const connect = useCallback(async () => {
    if (!supported) throw new Error('Wallets need the installed GateKeeper build. Expo Go cannot talk to wallet apps.');
    const res = await mwa().transact(async (w) => {
      let a: any;
      try { a = await w.authorize({ chain: CHAIN, identity: IDENTITY }); }
      catch { a = await w.authorize({ cluster: 'devnet', identity: IDENTITY }); }
      return { authToken: a.auth_token as string, address: a.accounts[0].address as string, label: nameFrom(a.wallet_uri_base) };
    });
    await save(res);
  }, []);

  const disconnect = useCallback(async () => {
    if (auth && supported) {
      try { await mwa().transact(async (w) => { await w.deauthorize({ auth_token: auth.authToken }); }); } catch { /* wallet closed */ }
    }
    await SecureStore.deleteItemAsync(K_MWA);
    await SecureStore.deleteItemAsync('gk.session');
    await SecureStore.deleteItemAsync('gk.org');
    setAuth(null);
  }, [auth]);

  /** Runs `fn` in one wallet session, re-authorizing silently with the saved token. */
  const withWallet = useCallback(async <T,>(fn: (w: any, address: string) => Promise<T>): Promise<T> => {
    if (!auth) throw new Error('Connect a wallet first');
    return mwa().transact(async (w) => {
      let a: any;
      try {
        try { a = await w.authorize({ chain: CHAIN, identity: IDENTITY, auth_token: auth.authToken }); }
        catch { a = await w.authorize({ cluster: 'devnet', identity: IDENTITY, auth_token: auth.authToken }); }
      } catch {
        try { a = await w.authorize({ chain: CHAIN, identity: IDENTITY }); }
        catch {
          try { a = await w.authorize({ cluster: 'devnet', identity: IDENTITY }); }
          catch { throw new Error('Your wallet rejected the request. Make sure it is set to Devnet, then disconnect and reconnect.'); }
        }
      }
      if (a.accounts?.[0]?.address !== auth.address) {
        throw new Error('Wrong wallet app. Choose the wallet you connected with, or disconnect and reconnect.');
      }
      const next = { authToken: a.auth_token as string, address: auth.address, label: nameFrom(a.wallet_uri_base) ?? auth.label };
      if (next.authToken !== auth.authToken) await save(next);
      return fn(w, auth.address);
    });
  }, [auth]);

  const signMessage = useCallback(async (msg: Uint8Array) => {
    const signed = await withWallet(async (w, address) => (await w.signMessages({ addresses: [address], payloads: [msg] }))[0] as Uint8Array);
    // MWA returns payload + 64-byte signature; keep the signature
    return signed.length === 64 ? signed : signed.slice(signed.length - 64);
  }, [withWallet]);

  const signTransactions = useCallback(
    (txs: VersionedTransaction[]) => withWallet(async (w) => (await w.signTransactions({ transactions: txs })) as VersionedTransaction[]),
    [withWallet],
  );

  const walletName = auth?.label ?? 'Wallet';
  const value = useMemo(
    () => ({ ready, publicKey, walletName, supported, connect, disconnect, signMessage, signTransactions }),
    [ready, publicKey, walletName, connect, disconnect, signMessage, signTransactions],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
