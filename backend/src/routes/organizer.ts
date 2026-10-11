import { Router } from 'express';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { buildPartialTx, connection, HttpError, payer, pk } from '../chain';
import { STAKE_AMOUNT, toSkr } from '../config';
import { isStaked, login, requireOrganizer } from '../auth';
import { fetchOrganizerStake, stakeOrganizerIx, unstakeOrganizerIx } from '../program';
import { loadState } from '../state';

export const organizer = Router();

/** GET /api/org/events -> events created by the caller */
organizer.get('/org/events', requireOrganizer, (_req, res) => {
  const s = loadState();
  const me = res.locals.wallet;
  res.json(s.events.filter((e) => e.createdBy === me).map((e) => ({
    id: e.id, name: e.name, faceValueSkr: e.faceValueSkr, minted: s.minted[e.id] ?? 0, capacity: e.capacity ?? 0,
  })));
});

/** GET /api/org/status/:wallet -> { staked, required } */
organizer.get('/org/status/:wallet', async (req, res, next) => {
  try {
    const w = pk(req.params.wallet, 'wallet');
    const stake = await fetchOrganizerStake(w);
    res.json({ staked: !!stake, amount: stake ? toSkr(stake.amount) : 0, required: toSkr(STAKE_AMOUNT) });
  } catch (e) { next(e); }
});

/** POST /api/org/stake/prepare { wallet } -> tx that locks the stake (backend pays the fees) */
organizer.post('/org/stake/prepare', async (req, res, next) => {
  try {
    const w = pk(req.body?.wallet, 'wallet');
    if (await fetchOrganizerStake(w)) throw new HttpError(409, 'Already staked');
    const token = getAssociatedTokenAddressSync(pk(loadState().skrMint), w);
    const bal = await connection.getTokenAccountBalance(token).catch(() => null);
    if (!bal || BigInt(bal.value.amount) < STAKE_AMOUNT) {
      throw new HttpError(402, `You need ${toSkr(STAKE_AMOUNT)} SKR to stake. Get test SKR from the SKR tab first`);
    }
    res.json({ tx: await buildPartialTx([stakeOrganizerIx({ payer: payer.publicKey, organizer: w, organizerToken: token })]) });
  } catch (e) { next(e); }
});

/** POST /api/org/unstake/prepare { wallet } */
organizer.post('/org/unstake/prepare', requireOrganizer, async (req, res, next) => {
  try {
    const w = pk(req.body?.wallet, 'wallet');
    if (!(await fetchOrganizerStake(w))) throw new HttpError(404, 'No stake found');
    const token = getAssociatedTokenAddressSync(pk(loadState().skrMint), w);
    res.json({ tx: await buildPartialTx([unstakeOrganizerIx({ organizer: w, organizerToken: token })]) });
  } catch (e) { next(e); }
});

/** POST /api/org/login { wallet, ts, sig } -> { token, exp } */
organizer.post('/org/login', async (req, res, next) => {
  try {
    const { wallet, ts, sig } = req.body ?? {};
    if (typeof wallet !== 'string' || typeof sig !== 'string' || typeof ts !== 'number') throw new HttpError(400, 'wallet, ts, sig required');
    res.json(await login(wallet, ts, sig));
  } catch (e) { next(e); }
});

/** GET /api/org/me/:wallet -> cheap re-check used after unstake */
organizer.get('/org/check/:wallet', async (req, res, next) => {
  try { res.json({ staked: await isStaked(pk(req.params.wallet).toBase58(), true) }); } catch (e) { next(e); }
});
