/**
 * One-off: add on-chain GateKeeper tickets that are missing from state.json.
 * Usage: npx tsx scripts/reconcile-tickets.ts <wallet> [wallet...]
 *   (no args = every wallet already known to state: organizers, holders, recipients)
 * Deletes nothing. A pending `sig:` record with the same event + seat + recipient is upgraded to the asset id.
 */
import { getAssetsByOwner } from '../src/das';
import { describe } from '../src/describe';
import { isGateKeeperTree, loadState, saveState } from '../src/state';

async function main() {
  const s = loadState();
  let wallets = process.argv.slice(2);
  if (!wallets.length) {
    wallets = [...new Set([
      ...s.events.map((e) => e.createdBy),
      ...Object.values(s.holders).map((h) => h.holder),
      ...Object.values(s.tickets).map((t) => t.recipient),
    ].filter((w): w is string => !!w))];
  }
  let added = 0, skipped = 0;
  for (const w of wallets) {
    const assets = (await getAssetsByOwner(w)).filter((a) => isGateKeeperTree(a.compression?.tree) && !a.burnt);
    for (const a of assets) {
      if (s.tickets[a.id]) continue;
      const d = describe(a);
      if (!d.eventId) { skipped++; continue; }
      const owner = a.ownership.owner;
      const pend = Object.entries(s.tickets).find(([k, t]) => k.startsWith('sig:') && t.eventId === d.eventId && t.seat === d.seat);
      const base = pend ? { ...pend[1], pendingAssetId: undefined } : { eventId: d.eventId, seat: d.seat, tier: d.tier, recipient: owner };
      if (pend) { delete s.tickets[pend[0]]; delete s.holders[pend[0]]; }
      s.tickets[a.id] = base;
      s.holders[a.id] = { holder: owner };
      added++;
      console.log(`+ ${a.id} ${d.eventId} ${d.seat} -> ${owner}`);
    }
  }
  // minted counters never go down
  for (const e of s.events) {
    const n = Object.values(s.tickets).filter((t) => t.eventId === e.id).length;
    if (n > (s.minted[e.id] ?? 0)) s.minted[e.id] = n;
  }
  saveState(s);
  console.log(`wallets=${wallets.length} added=${added} skipped(no event)=${skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
