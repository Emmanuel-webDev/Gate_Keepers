import { Router } from 'express';
import { PublicKey } from '@solana/web3.js';
import { createNoopSigner, publicKey as umiKey } from '@metaplex-foundation/umi';
import { fetchMerkleTree, getAssetWithProof, transfer as bubblegumTransfer } from '@metaplex-foundation/mpl-bubblegum';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { HttpError, buildPartialTx, connection, payer, pk, sendAsBackend, umi } from '../chain';
import { BOND_AMOUNT, VIP_AMOUNT, toSkr } from '../config';
import { requireOrganizer } from '../auth';
import { getAsset } from '../das';
import { burnVipIx, fetchBond, hasVip, lockBondIx, resolveBondIx } from '../program';
import { BondRec, getCheckin, isGateKeeperTree, loadState, saveState } from '../state';

export const bonds = Router();

// ---------------------------------------------------------------- helpers

/** Bring local bond records in line with the chain (PDA exists = locked). */
async function reconcile(recs: BondRec[]) {
  let changed = false;
  const st = loadState();
  await Promise.all(
    recs.filter((r) => r.status === 'pending' || r.status === 'locked').map(async (r) => {
      const b = await fetchBond(new PublicKey(r.assetId));
      if (b) {
        const p = st.holders[r.assetId]?.pending;
        if (p) {
          p.bondSeen = true;
          changed = true;
        }
        if (r.status === 'pending') { r.status = 'locked'; changed = true; }
      } else if (r.status === 'locked') {
        r.status = 'returned';
        changed = true;
      } else if (!b && r.status === 'pending' && Date.now() - r.ts > 10 * 60_000) {
        r.status = 'cancelled';
        changed = true;
        if (st.holders[r.assetId]?.pending?.to === r.to) {
          delete st.holders[r.assetId].pending;
        }
      }
    }),
  );
  if (changed) saveState(st);
}

function view(r: BondRec) {
  const st = loadState();
  const t = st.tickets[r.assetId];
  const ev = st.events.find((e) => e.id === t?.eventId);
  return { ...r, eventName: ev?.name ?? 'Ticket', venue: ev?.venue ?? '', date: ev?.date ?? '', seat: t?.seat ?? '—' };
}

function setStatus(assetId: string, status: BondRec['status']) {
  const st = loadState();
  const r = [...st.bonds].reverse().find((b) => b.assetId === assetId && (b.status === 'locked' || b.status === 'pending'));
  if (r) { r.status = status; saveState(st); }
}

async function requireOwner(assetId: string, wallet: string) {
  const st = loadState();
  if (st.tickets[assetId]?.voidedAt) {
    throw new HttpError(409, 'Duplicate ticket. Voided.');
  }
  if (st.tickets[assetId]?.checkedInAt || getCheckin(assetId)) {
    throw new HttpError(409, 'This ticket has already been used.');
  }
  const asset = await getAsset(assetId);
  if (!isGateKeeperTree(asset.compression?.tree)) throw new HttpError(400, 'Not a GateKeeper ticket');
  if (asset.ownership.owner !== wallet) throw new HttpError(403, 'You do not own this ticket');
}

async function refund(assetId: string) {
  const asset = new PublicKey(assetId);
  const bond = await fetchBond(asset);
  if (!bond) return null;
  const st = loadState();
  const p = st.holders[assetId]?.pending;
  if (p) {
    p.bondSeen = true;
  }
  const mint = pk(st.skrMint);
  const sig = await sendAsBackend([
    resolveBondIx({ authority: payer.publicKey, asset, slash: false, destination: getAssociatedTokenAddressSync(mint, bond.seller) }),
  ]);
  setStatus(assetId, 'returned');
  return sig;
}

/** Called on check-in: the buyer showed up, so the seller's bond comes back. No-op without a bond. */
export const releaseBondIfAny = refund;

// ---------------------------------------------------------------- attendee

/**
 * POST /api/transfer/prepare { assetId, from, to, priceSkr }
 * Two txs (backend already signed as fee payer): bondTx locks the SKR bond, transferTx moves the cNFT.
 * The declared resale price must be <= face value. (Declared, not enforced: the bond is the deterrent.)
 */
bonds.post('/transfer/prepare', async (req, res, next) => {
  try {
    const { assetId, from, to } = req.body ?? {};
    const seller = pk(from, 'from'); const buyer = pk(to, 'recipient'); const asset = pk(assetId, 'assetId');
    if (seller.equals(buyer)) throw new HttpError(400, 'Recipient must be a different wallet');
    await requireOwner(assetId, from);

    const st = loadState();
    const ev = st.events.find((e) => e.id === st.tickets[assetId]?.eventId);
    const price = Number(req.body?.priceSkr);
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Enter a valid asking price');
    if (ev && price > ev.faceValueSkr) throw new HttpError(400, `Resale is capped at face value (${ev.faceValueSkr} SKR)`);
    if (await fetchBond(asset)) throw new HttpError(409, 'A bond is already locked for this ticket');

    const mint = pk(st.skrMint);
    const sellerToken = getAssociatedTokenAddressSync(mint, seller);
    const bal = await connection.getTokenAccountBalance(sellerToken).catch(() => null);
    if (!bal || BigInt(bal.value.amount) < BOND_AMOUNT) {
      throw new HttpError(402, `You need ${toSkr(BOND_AMOUNT)} SKR for the transfer bond. Get test SKR in the SKR tab`);
    }

    const bondTx = await buildPartialTx([lockBondIx({ payer: payer.publicKey, seller, asset, sellerToken })]);

    // cNFT transfer: the seller is a required signer; a noop signer leaves their slot for the wallet.
    const proof = await getAssetWithProof(umi, umiKey(assetId));
    // truncateCanopy: drop proof nodes already stored in the tree's canopy (keeps tx size small)
    const canopyDepth = Math.log2((await fetchMerkleTree(umi, proof.merkleTree)).canopy.length + 2) - 1;
    if (canopyDepth > 0) proof.proof = proof.proof.slice(0, proof.proof.length - canopyDepth);
    const built = await bubblegumTransfer(umi, {
      ...proof,
      leafOwner: createNoopSigner(umiKey(from)),
      newLeafOwner: umiKey(to),
    }).buildWithLatestBlockhash(umi, { commitment: 'confirmed' });
    const transferTx = Buffer.from(umi.transactions.serialize(await umi.identity.signTransaction(built))).toString('base64');

    st.bonds = st.bonds.filter((b) => !(b.assetId === assetId && b.status === 'pending'));
    st.bonds.push({ assetId, seller: from, to, priceSkr: price, amount: toSkr(BOND_AMOUNT), status: 'pending', ts: Date.now() });
    st.holders[assetId] ??= { holder: from };
    st.holders[assetId].pending = { to, at: Date.now() };
    saveState(st);

    res.json({ bondTx, transferTx, bondAmount: toSkr(BOND_AMOUNT) });
  } catch (e) { next(e); }
});

/** POST /api/transfer/rollback { assetId, from }  -> bond was locked but the cNFT transfer failed: refund the seller. */
bonds.post('/transfer/rollback', async (req, res, next) => {
  try {
    const { assetId, from } = req.body ?? {};
    pk(assetId, 'assetId');
    await requireOwner(assetId, pk(from, 'from').toBase58()); // seller still owns it, so nothing was sold
    const signature = await refund(assetId);
    if (signature) setStatus(assetId, 'cancelled');
    const st = loadState();
    if (st.holders[assetId]?.pending) {
      delete st.holders[assetId].pending;
      saveState(st);
    }
    res.json({ refunded: !!signature, signature });
  } catch (e) { next(e); }
});

/** GET /api/transfers/:wallet -> bonds this wallet locked as a seller (newest first) */
bonds.get('/transfers/:wallet', async (req, res, next) => {
  try {
    const w = pk(req.params.wallet, 'wallet').toBase58();
    const st = loadState();
    const mine = st.bonds.filter((b) => b.seller === w && b.status !== 'cancelled');
    await reconcile(mine);
    res.json(mine.filter((b) => b.status !== 'pending').sort((a, b) => b.ts - a.ts).map(view));
  } catch (e) { next(e); }
});

/** POST /api/vip/prepare { assetId, owner }  -> unsigned burn_for_vip tx */
bonds.post('/vip/prepare', async (req, res, next) => {
  try {
    const { assetId, owner } = req.body ?? {};
    const ownerKey = pk(owner, 'owner'); const asset = pk(assetId, 'assetId');
    await requireOwner(assetId, owner);
    if (await hasVip(asset)) throw new HttpError(409, 'Already VIP');

    const mint = pk(loadState().skrMint);
    const ownerToken = getAssociatedTokenAddressSync(mint, ownerKey);
    const bal = await connection.getTokenAccountBalance(ownerToken).catch(() => null);
    if (!bal || BigInt(bal.value.amount) < VIP_AMOUNT) throw new HttpError(402, `You need ${toSkr(VIP_AMOUNT)} SKR. Get test SKR in the SKR tab`);

    res.json({ tx: await buildPartialTx([burnVipIx({ payer: payer.publicKey, owner: ownerKey, asset, skrMint: mint, ownerToken })]) });
  } catch (e) { next(e); }
});

/** POST /api/relay { tx: base64 }  -> broadcast a wallet-signed tx through our RPC */
bonds.post('/relay', async (req, res, next) => {
  try {
    if (typeof req.body?.tx !== 'string') throw new HttpError(400, 'tx (base64) required');
    const signature = await connection.sendRawTransaction(Buffer.from(req.body.tx, 'base64'), {
      preflightCommitment: 'confirmed',
    });
    const r = await connection.confirmTransaction(signature, 'confirmed');
    if (r.value.err) throw new HttpError(400, 'Transaction failed on-chain: ' + JSON.stringify(r.value.err));
    res.json({ signature });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- organizer

/** GET /api/org/bonds -> every bond currently held in escrow */
bonds.get('/org/bonds', requireOrganizer, async (_req, res, next) => {
  try {
    const st = loadState();
    await reconcile(st.bonds);
    res.json(st.bonds.filter((b) => b.status === 'locked').sort((a, b) => b.ts - a.ts).map(view));
  } catch (e) { next(e); }
});

/**
 * POST /api/org/bond/resolve { assetId, slash }
 * slash=true  "flag as resale": seller's bond goes to the treasury. The buyer's ticket stays valid.
 * slash=false refund the seller.
 */
bonds.post('/org/bond/resolve', requireOrganizer, async (req, res, next) => {
  try {
    const asset = pk(req.body?.assetId, 'assetId');
    const slash = !!req.body?.slash;
    const bond = await fetchBond(asset);
    if (!bond) throw new HttpError(404, 'No bond locked for this ticket');
    const st = loadState();
    const p = st.holders[asset.toBase58()]?.pending;
    if (p) {
      p.bondSeen = true;
    }
    const signature = await sendAsBackend([
      resolveBondIx({
        authority: payer.publicKey, asset, slash,
        destination: slash ? pk(st.treasury) : getAssociatedTokenAddressSync(pk(st.skrMint), bond.seller),
      }),
    ]);
    setStatus(asset.toBase58(), slash ? 'slashed' : 'returned');
    res.json({ signature, slashed: slash });
  } catch (e) { next(e); }
});
