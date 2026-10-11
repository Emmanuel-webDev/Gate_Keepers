import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

// Must stay identical to backend/src/routes/verify.ts
export const delegationMsg = (s: string, e: number) => `GateKeeper|session|v1|${s}|${e}`;
export const qrMsg = (a: string, t: number, n: string) => `GateKeeper|qr|v1|${a}|${t}|${n}`;
export const loginMsg = (ts: number) => `GateKeeper|organizer-login|v1|${ts}`;

const enc = (s: string) => new TextEncoder().encode(s);
const K = 'gk.session';
const SESSION_MS = 8 * 60 * 60 * 1000;

export type Session = { secret: string; pub: string; exp: number; owner: string; d: string };

/**
 * The wallet signs ONE "session delegation" (a single wallet prompt). After that the app re-signs a fresh
 * QR every 45 s with a throwaway session key, with no wallet prompt. The gate checks that the delegation was
 * signed by the wallet that CURRENTLY holds the cNFT on-chain.
 */
export async function ensureSession(
  owner: string,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>,
): Promise<Session> {
  const raw = await SecureStore.getItemAsync(K);
  if (raw) {
    const s: Session = JSON.parse(raw);
    if (s.owner === owner && s.exp - Date.now() > 10 * 60 * 1000) return s;
  }
  const kp = nacl.sign.keyPair();
  const pub = bs58.encode(kp.publicKey);
  const exp = Date.now() + SESSION_MS;
  const sig = await signMessage(enc(delegationMsg(pub, exp)));
  const s: Session = { secret: bs58.encode(kp.secretKey), pub, exp, owner, d: bs58.encode(sig) };
  await SecureStore.setItemAsync(K, JSON.stringify(s));
  return s;
}

export function buildQr(s: Session, assetId: string): { payload: string; sig: string } {
  const t = Date.now();
  const n = bs58.encode(nacl.randomBytes(8));
  const g = bs58.encode(nacl.sign.detached(enc(qrMsg(assetId, t, n)), bs58.decode(s.secret)));
  return { payload: JSON.stringify({ v: 1, a: assetId, t, n, s: s.pub, e: s.exp, d: s.d, g }), sig: g };
}

export async function signOrganizerLogin(signMessage: (m: Uint8Array) => Promise<Uint8Array>) {
  const ts = Date.now();
  const sig = bs58.encode(await signMessage(enc(loginMsg(ts))));
  return { ts, sig };
}
