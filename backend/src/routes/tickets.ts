import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { PublicKey } from '@solana/web3.js';
import { publicKey as umiKey, none, generateSigner } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createTree, findLeafAssetIdPda, getMerkleTreeSize, mintV1, parseLeafFromMintV1Transaction } from '@metaplex-foundation/mpl-bubblegum';
import { HttpError, connection, payer, pk, umi } from '../chain';
import { env, TREE_CAPACITY } from '../config';
import { requireOrganizer } from '../auth';
import { getAssetsByOwner } from '../das';
import { describe } from '../describe';
import { hasVip, vipPda } from '../program';
import { EventInfo, getCheckin, isGateKeeperTree, loadState, metadataDir, saveState, Tier } from '../state';

export const tickets = Router();

const MAX_EVENTS = 5;
// Smallest valid (maxDepth, maxBufferSize) pairs for capacities up to 2^17.
const TREE_SIZES: [number, number][] = [[3, 8], [5, 8], [14, 64], [15, 64], [16, 64], [17, 64]];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'event';

async function createEventTree(capacity: number): Promise<string> {
  const [maxDepth, maxBufferSize] = TREE_SIZES.find(([d]) => 2 ** d >= capacity)!;
  const canopyDepth = maxDepth > 14 ? maxDepth - 14 : 0;
  const size = getMerkleTreeSize(maxDepth, maxBufferSize, canopyDepth);
  const need = (await connection.getMinimumBalanceForRentExemption(size)) + 10_000_000;
  const have = await connection.getBalance(payer.publicKey);
  if (have < need) {
    throw new HttpError(503, `Backend wallet needs ${(need / 1e9).toFixed(3)} SOL to create a tree (has ${(have / 1e9).toFixed(3)})`);
  }
  const merkleTree = generateSigner(umi);
  await sendAndPoll(await createTree(umi, { merkleTree, maxDepth, maxBufferSize, canopyDepth }), 'Tree creation is still processing. Try again in a minute.');
  return merkleTree.publicKey.toString();
}

/**
 * Send once (preflight on), then poll getSignatureStatuses for up to 60 s.
 * Never relies on blockhash expiry: "block height exceeded" was a false negative and retrying duplicated mints.
 */
async function sendAndPoll(builder: { send: (u: typeof umi) => Promise<Uint8Array> }, pendingMsg: string): Promise<Uint8Array> {
  const sig = await builder.send(umi);
  const s58 = base58.deserialize(sig)[0];
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = (await connection.getSignatureStatuses([s58], { searchTransactionHistory: true }).catch(() => null))?.value[0];
    if (st?.err) throw new HttpError(502, `Transaction failed on-chain: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
  }
  throw new HttpError(504, pendingMsg);
}

/** POST /api/tickets/mint  { eventId, recipientAddress, tier } | { eventName, capacity, faceValueSkr, recipientAddress, tier } */
tickets.post('/tickets/mint', requireOrganizer, async (req, res, next) => {
  try {
    const { recipientAddress, eventId, eventName, capacity, faceValueSkr, venue, startsAt } = req.body ?? {};
    const tier: Tier = req.body?.tier === 'VIP Access' ? 'VIP Access' : 'General';
    const recipient = pk(recipientAddress, 'recipientAddress');
    const me: string = res.locals.wallet;
    const state = loadState();
    let event: EventInfo | undefined;
    if (eventId) {
      event = state.events.find((e) => e.id === eventId);
      if (!event) throw new HttpError(404, 'Unknown event');
      if (event.createdBy !== me) throw new HttpError(403, 'Not your event');
    } else {
      const nm = typeof eventName === 'string' ? eventName.trim() : '';
      if (nm.length < 3 || nm.length > 60) throw new HttpError(400, 'Event name must be 3-60 characters');
      const cap = Number(capacity), fv = Number(faceValueSkr);
      if (!Number.isInteger(cap) || cap < 1 || cap > 131072) throw new HttpError(400, 'Capacity must be an integer 1-131072');
      if (!Number.isFinite(fv) || fv <= 0) throw new HttpError(400, 'Face value must be > 0');
      const id = `${slug(nm)}-${me.slice(0, 6)}`;
      event = state.events.find((e) => e.id === id);
      if (event && event.createdBy !== me) throw new HttpError(409, 'Event id already taken');
      if (!event) {
        if (!startsAt || typeof startsAt !== 'string') throw new HttpError(400, 'Event date and time is required');
        const parsedStartsAt = new Date(startsAt);
        if (isNaN(parsedStartsAt.getTime()) || parsedStartsAt.getTime() <= Date.now()) {
          throw new HttpError(400, 'Event date and time must be in the future');
        }
        const eventVenue = typeof venue === 'string' && venue.trim() ? venue.trim() : '';
        if (state.events.filter((e) => e.createdBy === me).length >= MAX_EVENTS) throw new HttpError(409, `Limit of ${MAX_EVENTS} events per organizer`);
        const tree = await createEventTree(cap);
        event = {
          id, name: nm, short: nm.slice(0, 22), venue: eventVenue, date: parsedStartsAt.toISOString(), faceValueSkr: fv,
          image: state.events[0]?.image ?? '', createdBy: me, capacity: cap, tree, perWalletLimit: 1,
        };
        state.events.push(event);
        state.minted[id] = 0;
        saveState(state);
      }
    }
    if (event.capacity != null) {
      if ((state.minted[event.id] ?? 0) >= event.capacity) throw new HttpError(409, 'Sold out');
    } else {
      const total = Object.values(state.minted).reduce((a, b) => a + b, 0);
      if (total >= TREE_CAPACITY) throw new HttpError(409, 'Merkle tree is full');
    }
    // One ticket per wallet per event, counted from persisted state.
    const to58 = recipient.toBase58();
    const held = Object.entries(state.tickets).filter(([k, t]) =>
      t.eventId === event!.id && (t.recipient ?? state.holders[k]?.holder) === to58).length;
    if (held >= (event.perWalletLimit ?? 1)) throw new HttpError(409, 'This wallet already has a ticket for this event');

    const n = (state.minted[event.id] ?? 0) + 1;
    const seat = `${tier === 'VIP Access' ? 'VIP' : 'GA'}-${String(n).padStart(4, '0')}`;
    const name = `${event.short} ${seat}`; // <= 32 chars, seat last so it survives without metadata

    // Metadata is served by this backend at /metadata (swap for Irys/Arweave in production).
    const file = `${event.id}-${n}.json`;
    fs.mkdirSync(metadataDir, { recursive: true });
    fs.writeFileSync(
      path.join(metadataDir, file),
      JSON.stringify({
        name,
        symbol: 'GATE',
        description: `${tier} ticket for ${event.name} at ${event.venue}.`,
        image: event.image,
        attributes: [
          { trait_type: 'EventId', value: event.id },
          { trait_type: 'Event', value: event.name },
          { trait_type: 'Venue', value: event.venue },
          { trait_type: 'Date', value: event.date },
          { trait_type: 'Seat', value: seat },
          { trait_type: 'Tier', value: tier },
          { trait_type: 'FaceValueSkr', value: String(event.faceValueSkr) },
        ],
      }),
    );

    const tree = umiKey(event.tree ?? state.tree);
    const signature = await sendAndPoll(mintV1(umi, {
      leafOwner: umiKey(to58),
      merkleTree: tree,
      metadata: {
        name,
        uri: `${env.publicUrl}/metadata/${file}`,
        sellerFeeBasisPoints: 0,
        collection: none(),
        creators: [],
      },
    }), 'Mint is still processing. Check My Tickets before retrying.');
    const s58 = base58.deserialize(signature)[0];

    // Confirmed: count it now so nothing below can skip persisting it.
    state.minted[event.id] = n;
    const rec = { eventId: event.id, seat, tier, mintedBy: me, recipient: to58, signature: s58 };
    const sigKey = `sig:${s58}`;
    state.tickets[sigKey] = { ...rec, pendingAssetId: true };
    state.holders[sigKey] = { holder: to58 };
    saveState(state);

    // Resolve the asset id from the mint tx (retry: RPC may lag a moment).
    let assetId: string | null = null;
    for (let i = 0; i < 8 && !assetId; i++) {
      try {
        const leaf = await parseLeafFromMintV1Transaction(umi, signature);
        assetId = findLeafAssetIdPda(umi, { merkleTree: tree, leafIndex: leaf.nonce })[0];
      } catch {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    if (assetId) {
      delete state.tickets[sigKey];
      delete state.holders[sigKey];
      state.tickets[assetId] = rec;
      state.holders[assetId] = { holder: to58 };
      saveState(state);
    }

    res.json({ assetId, seat, tier, signature: s58, eventId: event.id, pendingAssetId: !assetId });
  } catch (e) { next(e); }
});

/** GET /api/tickets/:owner -> this wallet's tickets (Helius DAS getAssetsByOwner) */
tickets.get('/tickets/:owner', async (req, res, next) => {
  try {
    const owner = pk(req.params.owner, 'owner').toBase58();
    const st = loadState();
    const assets = (await getAssetsByOwner(owner)).filter((a) => isGateKeeperTree(a.compression?.tree) && !a.burnt && !st.tickets[a.id]?.voidedAt);

    const vipInfos = assets.length
      ? await connection.getMultipleAccountsInfo(assets.map((a) => vipPda(new PublicKey(a.id))))
      : [];

    res.json(
      assets.map((a, i) => {
        const d = describe(a);
        const t = st.tickets[a.id];
        const checkedInAt = t?.checkedInAt ?? (getCheckin(a.id) ? new Date(getCheckin(a.id)!).toISOString() : null);
        return {
          assetId: a.id,
          eventId: d.ev?.id,
          name: d.ev?.name ?? a.content?.metadata?.name ?? 'Ticket',
          venue: d.ev?.venue ?? '',
          date: d.ev?.date ?? new Date().toISOString(),
          seat: d.seat,
          tier: vipInfos[i] || d.tier === 'VIP Access' ? 'VIP Access' : 'General',
          faceValueSkr: d.ev?.faceValueSkr ?? 0,
          checkedInAt: checkedInAt ?? null,
        };
      }),
    );
  } catch (e) { next(e); }
});

/** GET /api/ticket/:assetId -> status of a single ticket */
tickets.get('/ticket/:assetId', async (req, res, next) => {
  try {
    const assetId = pk(req.params.assetId, 'assetId').toBase58();
    const st = loadState();
    const t = st.tickets[assetId];
    const checkedInAt = t?.checkedInAt ?? (getCheckin(assetId) ? new Date(getCheckin(assetId)!).toISOString() : null);
    let vip = false;
    try { vip = await hasVip(new PublicKey(assetId)); } catch { /* ignore */ }
    res.json({
      assetId,
      checkedInAt: checkedInAt ?? null,
      tier: vip || t?.tier === 'VIP Access' ? 'VIP Access' : 'General',
      voidedAt: t?.voidedAt ?? null,
    });
  } catch (e) { next(e); }
});
