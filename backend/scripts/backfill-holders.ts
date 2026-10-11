import { getAsset } from '../src/das';
import { loadState, saveState } from '../src/state';

async function main() {
  const state = loadState();
  const ticketEntries = Object.entries(state.tickets);
  console.log(`Checking ${ticketEntries.length} tickets in state.tickets...`);

  let filled = 0;
  for (const [assetId] of ticketEntries) {
    if (!state.holders[assetId]) {
      try {
        const asset = await getAsset(assetId);
        const owner = asset.ownership.owner;
        state.holders[assetId] = { holder: owner };
        filled++;
        console.log(`Backfilled asset ${assetId} -> holder ${owner}`);
      } catch (err: any) {
        console.error(`Failed to fetch asset ${assetId}:`, err.message);
      }
    }
  }

  saveState(state);
  console.log(`Backfill complete. Filled ${filled} ticket(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
