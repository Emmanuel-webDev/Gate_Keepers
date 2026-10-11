import { Router } from 'express';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { QR_WINDOW_MS } from '../config';
import { requireOrganizer } from '../auth';
import { DasAsset, getAsset } from '../das';
import { describe } from '../describe';
import { fetchBond, hasVip } from '../program';
import { getCheckin, isGateKeeperTree, loadState, saveState, setCheckin } from '../state';
import { releaseBondIfAny } from './bonds';

export const verify = Router();

/**
 * QR payload (compact JSON, produced on the phone):
 *  a assetId | t unix-ms | n nonce | s session pubkey | e delegation expiry (unix-ms)
 *  d wallet signature over delegationMsg(s,e)   (signed ONCE via MWA, checked against the CURRENT on-chain owner)
 *  g session signature over qrMsg(a,t,n)        (re-signed by the phone, no wallet prompt)
 * The owner is NOT in the payload (smaller QR, easier to scan): we take it from the chain.
 * Keep these message formats identical to app/src/lib/qr.ts.
 */
type QR = { v: 1; a: string; t: number; n: string; s: string; e: number; d: string; g: string };
export const delegationMsg = (s: string, e: number) => `GateKeeper|session|v1|${s}|${e}`;
export const qrMsg = (a: string, t: number, n: string) => `GateKeeper|qr|v1|${a}|${t}|${n}`;

const usedNonces = new Map<string, number>();
const enc = (s: string) => new TextEncoder().encode(s);
const sigOk = (msg: string, sig: string, pub: string) => {
  try { return nacl.sign.detached.verify(enc(msg), bs58.decode(sig), new PublicKey(pub).toBytes()); } catch { return false; }
};
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

type Check = { key?: string; label: string; state: 'pass' | 'fail' | 'skip'; ok?: boolean; detail?: string };

/** POST /api/verify { qr }  (organizers only). Always returns all checks so the gate UI can show them. */
verify.post('/verify', requireOrganizer, async (req, res) => {
  const t0 = Date.now();
  const checks: Check[] = [
    { key: 'parsed', label: 'QR payload parsed', state: 'skip', ok: false },
    { key: 'fresh', label: 'Signed in the last 60s', state: 'skip', ok: false },
    { key: 'owner', label: 'Signer owns the cNFT', state: 'skip', ok: false },
    { key: 'registered', label: 'Transfer registered', state: 'skip', ok: false },
    { key: 'unused', label: 'Not yet checked in', state: 'skip', ok: false },
  ];
  let label: string | undefined;
  const done = (approved: boolean, headline: string, ticket?: object) =>
    res.json({ approved, headline, label, checks, ticket, ms: Date.now() - t0 });

  try {
    let q: QR;
    try {
      q = JSON.parse(req.body.qr);
      if (q.v !== 1 || !q.a || !q.s || !q.d || !q.g) throw new Error();
    } catch {
      checks[0] = { key: 'parsed', label: checks[0].label, state: 'fail', ok: false };
      return done(false, "That isn't a GateKeeper pass.");
    }
    checks[0] = { key: 'parsed', label: checks[0].label, state: 'pass', ok: true };

    // 1) on-chain: who holds this cNFT right now?
    let asset: DasAsset | null = null;
    let vip = false;
    try { asset = await getAsset(q.a); } catch { /* unknown asset */ }
    try { vip = await hasVip(new PublicKey(q.a)); } catch { /* no vip or rpc error */ }
    const state = loadState();
    const ours = !!asset && !asset.burnt && isGateKeeperTree(asset.compression?.tree);
    const owner = ours ? asset!.ownership.owner : '';

    // 2) crypto + freshness
    const age = Date.now() - q.t;
    const qrSigOk = sigOk(qrMsg(q.a, q.t, q.n), q.g, q.s); // session key signed this code
    const delegationOk = !!owner && q.e > Date.now() && sigOk(delegationMsg(q.s, q.e), q.d, owner); // CURRENT owner approved that session key
    const fresh = age <= QR_WINDOW_MS && age >= -5_000;
    for (const [k, ts] of usedNonces) if (Date.now() - ts > 2 * QR_WINDOW_MS) usedNonces.delete(k);
    const replay = usedNonces.has(q.n);
    const secs = Math.max(0, Math.round(age / 1000));

    checks[1] = !qrSigOk
      ? { key: 'fresh', label: checks[1].label, state: 'fail', ok: false, detail: 'invalid signature' }
      : !fresh
        ? { key: 'fresh', label: checks[1].label, state: 'fail', ok: false, detail: `signed ${secs}s ago` }
        : replay
          ? { key: 'fresh', label: checks[1].label, state: 'fail', ok: false, detail: 'code already scanned' }
          : { key: 'fresh', label: checks[1].label, state: 'pass', ok: true, detail: `signed ${secs}s ago` };

    checks[2] = !ours
      ? { key: 'owner', label: checks[2].label, state: 'fail', ok: false, detail: 'not a GateKeeper ticket' }
      : { key: 'owner', label: checks[2].label, state: delegationOk ? 'pass' : 'fail', ok: delegationOk, detail: `owner ${short(owner)}` };

    // 3) gate rule: legitimate holder registration check
    const rec = state.holders[q.a];
    let registeredOk = false;
    let registeredDetail: string | undefined;
    let registeredHeadline = 'Unregistered transfer. Not sold through GateKeeper.';

    if (rec && owner && owner === rec.holder) {
      registeredOk = true;
      registeredDetail = 'holder registered';
    } else if (rec?.pending && owner && owner === rec.pending.to) {
      const expired = rec.pending.at && (Date.now() - rec.pending.at > 10 * 60_000);
      let bond = null;
      try { bond = await fetchBond(new PublicKey(q.a)); } catch { /* no bond or rpc error */ }
      const bondOk = (bond && bond.seller.toBase58() === rec.holder) || !!rec.pending.bondSeen;

      if (!bondOk) {
        registeredOk = false;
        registeredDetail = 'no bond';
        registeredHeadline = 'Unregistered transfer. No bond locked.';
      } else if (expired) {
        registeredOk = false;
        registeredDetail = 'transfer expired';
      } else {
        // In-app transfer went through: promote to legitimate holder
        rec.holder = owner;
        delete rec.pending;
        saveState(state);
        registeredOk = true;
        registeredDetail = 'transfer confirmed';
      }
    } else {
      registeredOk = false;
      registeredDetail = 'unregistered transfer';
    }

    checks[3] = {
      key: 'registered',
      label: checks[3].label,
      state: registeredOk ? 'pass' : 'fail',
      ok: registeredOk,
      detail: registeredDetail,
    };

    const d = ours ? describe(asset!) : null;
    if (d) label = `${(d.ev?.name ?? 'Ticket').toUpperCase()} · ${d.seat.replace('-', ' ')}`;

    // 4) not already used
    const existingRec = state.tickets[q.a];
    const usedTs = getCheckin(q.a);
    const existingCheckin = existingRec?.checkedInAt ?? (usedTs ? new Date(usedTs).toISOString() : undefined);
    const checkinTime = existingCheckin
      ? new Date(existingCheckin).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';
    const alreadyMsg = checkinTime ? `Already checked in at ${checkinTime}.` : 'Already checked in.';

    checks[4] = existingCheckin
      ? { key: 'unused', label: checks[4].label, state: 'fail', ok: false, detail: checkinTime ? `checked in at ${checkinTime}` : 'already used' }
      : { key: 'unused', label: checks[4].label, state: 'pass', ok: true };

    if (!qrSigOk) return done(false, "Signature doesn't match. Forged pass.");
    if (!fresh) return done(false, "Stale signature. That's a screenshot.");
    if (replay) return done(false, 'That code was already scanned.');
    if (!ours) return done(false, 'Not a GateKeeper ticket.');
    if (!delegationOk) return done(false, "Signed by a wallet that doesn't hold this ticket.");
    if (!registeredOk) return done(false, registeredHeadline);
    if (existingRec?.voidedAt) return done(false, 'Duplicate ticket. Voided.');
    if (existingCheckin) return done(false, alreadyMsg);

    // Guard: Check-in must be atomic before any await
    const finalState = loadState();
    const curr = finalState.tickets[q.a];
    if (curr?.voidedAt) return done(false, 'Duplicate ticket. Voided.');
    const currCheckin = curr?.checkedInAt ?? (getCheckin(q.a) ? new Date(getCheckin(q.a)!).toISOString() : undefined);
    if (currCheckin) {
      const cTime = new Date(currCheckin).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return done(false, cTime ? `Already checked in at ${cTime}.` : 'Already checked in.');
    }

    const checkInIso = new Date().toISOString();
    const organizerWallet = res.locals.wallet as string;
    if (!finalState.tickets[q.a]) {
      finalState.tickets[q.a] = {
        eventId: d?.ev?.id ?? '',
        seat: d?.seat ?? '',
        tier: vip || d?.tier === 'VIP Access' ? 'VIP Access' : 'General',
        recipient: owner,
      };
    }
    finalState.tickets[q.a].checkedInAt = checkInIso;
    finalState.tickets[q.a].checkedInBy = organizerWallet;
    usedNonces.set(q.n, Date.now());
    setCheckin(q.a);
    saveState(finalState);

    releaseBondIfAny(q.a).catch((e) => console.error('bond release failed', e)); // keep the scan fast

    return done(true, 'Let them in.', {
      assetId: q.a, seat: d!.seat, event: d!.ev?.name, tier: vip || d!.tier === 'VIP Access' ? 'VIP Access' : 'General', owner, checkedInAt: checkInIso,
    });
  } catch (e: any) {
    console.error(e);
    return done(false, 'Verifier error: ' + (e.message ?? 'unknown'));
  }
});
