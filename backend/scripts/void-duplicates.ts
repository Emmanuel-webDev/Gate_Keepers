import fs from 'fs';
import path from 'path';
import { DasAsset, getAsset, getAssetsByOwner } from '../src/das';
import { describe } from '../src/describe';
import { getDataDir, isGateKeeperTree, loadState, saveState, Tier } from '../src/state';

interface TicketInfo {
  assetId: string;
  eventId: string;
  eventName: string;
  seat: string;
  tier: Tier;
  leafId: number;
  voidedAt?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const walletArgs = args.filter((a) => a !== '--apply');
  const wallet = walletArgs[0];

  if (!wallet) {
    console.error('Usage: npx tsx scripts/void-duplicates.ts <wallet> [--apply]');
    process.exit(1);
  }

  const s = loadState();
  const dir = getDataDir();
  const stateFile = path.join(dir, 'state.json');

  console.log(`Scanning tickets for wallet: ${wallet}`);

  // 1) Collect tickets from on-chain DAS and state
  let onChainAssets: DasAsset[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      onChainAssets = (await getAssetsByOwner(wallet)).filter(
        (a) => isGateKeeperTree(a.compression?.tree) && !a.burnt,
      );
      break;
    } catch (e: any) {
      if (attempt === 3) console.warn(`Warning: failed to query DAS: ${e.message}`);
      else await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const assetMap = new Map<string, DasAsset>();
  for (const a of onChainAssets) assetMap.set(a.id, a);

  // Combine on-chain assets and state tickets matching this wallet
  const candidateIds = new Set<string>();
  for (const a of onChainAssets) candidateIds.add(a.id);
  for (const [id, t] of Object.entries(s.tickets)) {
    if (id.startsWith('sig:')) continue;
    const h = s.holders[id]?.holder;
    if (h === wallet || (!h && t.recipient === wallet)) {
      candidateIds.add(id);
    }
  }

  const ticketList: TicketInfo[] = [];
  const stateKeys = Object.keys(s.tickets);

  for (const assetId of candidateIds) {
    let das = assetMap.get(assetId);
    if (!das) {
      try {
        das = await getAsset(assetId);
        assetMap.set(assetId, das);
      } catch {
        // RPC might fail or asset not found
      }
    }

    const t = s.tickets[assetId];
    const d = das ? describe(das) : null;
    const eventId = t?.eventId || d?.ev?.id || '';
    if (!eventId) continue;

    const eventName = s.events.find((e) => e.id === eventId)?.name || d?.ev?.name || 'Unknown Event';
    const seat = t?.seat || d?.seat || 'GA';
    const tier = t?.tier || (d?.tier === 'VIP Access' ? 'VIP Access' : 'General');
    const leafId = das?.compression?.leaf_id !== undefined
      ? das.compression.leaf_id
      : stateKeys.indexOf(assetId) >= 0 ? stateKeys.indexOf(assetId) : 999999;

    ticketList.push({
      assetId,
      eventId,
      eventName,
      seat,
      tier,
      leafId,
      voidedAt: t?.voidedAt,
    });
  }

  // Group by event
  const byEvent = new Map<string, TicketInfo[]>();
  for (const item of ticketList) {
    const list = byEvent.get(item.eventId) || [];
    list.push(item);
    byEvent.set(item.eventId, list);
  }

  let totalDuplicates = 0;
  const plan: { eventId: string; eventName: string; kept: TicketInfo; voided: TicketInfo[] }[] = [];

  for (const [eventId, items] of byEvent.entries()) {
    if (items.length <= 1) continue;

    // Sort by leafId (earliest-minted first)
    items.sort((a, b) => a.leafId - b.leafId);

    const kept = items[0];
    const voided = items.slice(1);
    totalDuplicates += voided.length;

    plan.push({
      eventId,
      eventName: kept.eventName,
      kept,
      voided,
    });
  }

  if (plan.length === 0) {
    console.log(`No duplicate tickets found for wallet ${wallet}.`);
    return;
  }

  console.log(`\nFound ${totalDuplicates} duplicate ticket(s) across ${plan.length} event(s):\n`);

  for (const p of plan) {
    console.log(`Event: ${p.eventName} (${p.eventId})`);
    console.log(`  [KEPT]   ${p.kept.assetId} (leaf_id: ${p.kept.leafId}, seat: ${p.kept.seat})${p.kept.voidedAt ? ' [previously voided]' : ''}`);
    for (const v of p.voided) {
      console.log(`  [VOID]   ${v.assetId} (leaf_id: ${v.leafId}, seat: ${v.seat}) -> reason: duplicate mint${v.voidedAt ? ' [already voided]' : ''}`);
    }
    console.log('');
  }

  if (!apply) {
    console.log('[DRY RUN] No changes were written to state.json.');
    console.log('Run with --apply to back up state.json and apply voidedAt marks.');
    return;
  }

  // Backup state.json before changing it
  if (fs.existsSync(stateFile)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(dir, `state.backup-${timestamp}.json`);
    fs.copyFileSync(stateFile, backupFile);
    console.log(`[BACKUP] Created backup at ${backupFile}`);
  }

  const nowIso = new Date().toISOString();
  for (const p of plan) {
    // If kept was accidentally voided, remove void
    if (s.tickets[p.kept.assetId]?.voidedAt) {
      delete s.tickets[p.kept.assetId].voidedAt;
      delete s.tickets[p.kept.assetId].reason;
    }
    for (const v of p.voided) {
      s.tickets[v.assetId] ??= {
        eventId: v.eventId,
        seat: v.seat,
        tier: v.tier,
        recipient: wallet,
      };
      s.tickets[v.assetId].voidedAt = nowIso;
      s.tickets[v.assetId].reason = 'duplicate mint';
    }
  }

  saveState(s);
  console.log('[APPLIED] Successfully updated state.json. Duplicate tickets marked voidedAt with reason "duplicate mint".');
  console.log(`Kept asset id: ${plan.map((p) => p.kept.assetId).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
