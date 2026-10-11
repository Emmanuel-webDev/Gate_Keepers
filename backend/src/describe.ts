import { attr, DasAsset } from './das';
import { loadState, Tier } from './state';

/**
 * Event / seat / tier for an asset. Does NOT rely on Helius fetching our metadata URI (it can't when
 * PUBLIC_URL is a LAN address). Order: local mint index -> metadata attributes -> on-chain name.
 */
export function describe(a: DasAsset) {
  const st = loadState();
  const idx = st.tickets[a.id];
  const name = a.content?.metadata?.name ?? '';
  const seat = idx?.seat ?? attr(a, 'Seat') ?? name.match(/((?:GA|VIP)-\d+)\s*$/)?.[1] ?? '—';
  const eventId = idx?.eventId ?? attr(a, 'EventId') ?? st.events.find((e) => name.startsWith(e.short))?.id;
  const ev = st.events.find((e) => e.id === eventId);
  const tier: Tier = idx?.tier ?? (seat.startsWith('VIP') ? 'VIP Access' : 'General');
  return { ev, eventId, seat, tier };
}
