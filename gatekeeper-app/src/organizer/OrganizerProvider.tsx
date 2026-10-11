import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useWallet } from '../wallet/WalletProvider';
import { api, setOrgToken, setUnauthorizedHandler } from '../lib/api';
import { signOrganizerLogin } from '../lib/qr';
import { signAndRelay } from '../lib/tx';

/** Organizer mode = an on-chain SKR stake + a signed login. Both are required to use organizer endpoints. */
type Ctx = {
  loading: boolean;
  staked: boolean;
  authed: boolean;
  required: number;
  sessionError: string | null;
  refresh: () => Promise<void>;
  stake: () => Promise<void>;
  unstake: () => Promise<void>;
  login: () => Promise<void>;
};
const C = createContext<Ctx>(null as any);
export const useOrganizer = () => useContext(C);
const K = 'gk.org';

export function OrganizerProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, signMessage, signTransactions } = useWallet();
  const wallet = publicKey?.toBase58() ?? '';
  const [loading, setLoading] = useState(true);
  const [staked, setStaked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [required, setRequired] = useState(1000);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const clear = useCallback(async (msg?: string) => {
    setOrgToken(''); setAuthed(false);
    await SecureStore.deleteItemAsync(K);
    if (msg) setSessionError(msg);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clear('Your organizer session ended. Sign in again or lock SKR.');
    });
  }, [clear]);

  const refresh = useCallback(async () => {
    if (!wallet) { setStaked(false); setAuthed(false); setLoading(false); return; }
    setLoading(true);
    try {
      const st = await api.orgStatus(wallet);
      setStaked(st.staked); setRequired(st.required);
      if (!st.staked) { await clear(); return; }
      const raw = await SecureStore.getItemAsync(K);
      if (raw) {
        const v = JSON.parse(raw) as { wallet: string; token: string; exp: number };
        if (v.wallet === wallet && v.exp > Date.now() + 60_000) { setOrgToken(v.token); setAuthed(true); return; }
      }
      setAuthed(false);
    } catch { /* offline: keep previous state */ } finally { setLoading(false); }
  }, [wallet, clear]);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async () => {
    setSessionError(null);
    const { ts, sig } = await signOrganizerLogin(signMessage);
    const { token, exp } = await api.orgLogin(wallet, ts, sig);
    setOrgToken(token);
    await SecureStore.setItemAsync(K, JSON.stringify({ wallet, token, exp }));
    setAuthed(true);
  }, [wallet, signMessage]);

  const stake = useCallback(async () => {
    setSessionError(null);
    const { tx } = await api.orgStakePrepare(wallet);
    await signAndRelay(signTransactions, [tx]);
    setStaked(true);
    await login();
  }, [wallet, signTransactions, login]);

  const unstake = useCallback(async () => {
    const { tx } = await api.orgUnstakePrepare(wallet);
    await signAndRelay(signTransactions, [tx]);
    await clear();
    setStaked(false);
  }, [wallet, signTransactions, clear]);

  const value = useMemo(() => ({ loading, staked, authed, required, sessionError, refresh, stake, unstake, login }), [loading, staked, authed, required, sessionError, refresh, stake, unstake, login]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
