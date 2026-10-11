import { createHash, createHmac } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { HttpError, payer, pk } from './chain';
import { fetchOrganizerStake } from './program';

/**
 * Organizer auth: the wallet signs one login message; we check it holds an on-chain stake and
 * hand back a signed, stateless token (survives server restarts). Every organizer endpoint also
 * re-checks the stake (cached 20 s) so unstaking locks you out quickly.
 */
const SECRET = createHash('sha256').update(payer.secretKey).digest();
const TTL_MS = 8 * 60 * 60 * 1000;

export const loginMsg = (ts: number) => `GateKeeper|organizer-login|v1|${ts}`;

const b64 = (b: Buffer) => b.toString('base64url');
const mac = (body: string) => b64(createHmac('sha256', SECRET).update(body).digest());

export function makeToken(wallet: string) {
  const exp = Date.now() + TTL_MS;
  const body = b64(Buffer.from(JSON.stringify({ w: wallet, exp })));
  return { token: `${body}.${mac(body)}`, exp };
}

function readToken(token: string): { w: string; exp: number } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig || mac(body) !== sig) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString());
    return v.exp > Date.now() ? v : null;
  } catch { return null; }
}

const stakeCache = new Map<string, { ok: boolean; at: number }>();

export async function isStaked(wallet: string, fresh = false) {
  const c = stakeCache.get(wallet);
  if (!fresh && c && Date.now() - c.at < 20_000) return c.ok;
  const ok = !!(await fetchOrganizerStake(pk(wallet)));
  stakeCache.set(wallet, { ok, at: Date.now() });
  return ok;
}

export async function login(wallet: string, ts: number, sig: string) {
  if (Math.abs(Date.now() - ts) > 2 * 60_000) throw new HttpError(400, 'Login expired, try again');
  const ok = nacl.sign.detached.verify(
    new TextEncoder().encode(loginMsg(ts)), bs58.decode(sig), pk(wallet).toBytes(),
  );
  if (!ok) throw new HttpError(401, 'Bad signature');
  if (!(await isStaked(wallet, true))) throw new HttpError(403, 'Lock SKR to become an organizer first');
  return makeToken(wallet);
}

export async function requireOrganizer(req: Request, res: Response, next: NextFunction) {
  try {
    const t = readToken((req.header('authorization') ?? '').replace(/^Bearer\s+/i, ''));
    if (!t) throw new HttpError(401, 'Organizer session expired');
    if (!(await isStaked(t.w))) throw new HttpError(403, 'Organizer stake not found');
    res.locals.wallet = t.w;
    next();
  } catch (e) { next(e); }
}
