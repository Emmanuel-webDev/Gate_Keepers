export const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8787'; // 10.0.2.2 = Android emulator -> host

let token = '';
let onUnauthorized: () => void = () => {};
export const setOrgToken = (t: string) => { token = t; };
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function call<T>(path: string, init?: RequestInit, auth = false): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if ((res.status === 401 || res.status === 403) && auth) onUnauthorized();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}
const post = <T,>(path: string, data: unknown, auth = false) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(data) }, auth);

export type Tier = 'General' | 'VIP Access';
export type EventInfo = {
  id: string; name: string; short: string; venue: string; date: string; faceValueSkr: number; minted: number;
};
export type Ticket = {
  assetId: string; eventId?: string; name: string; venue: string; date: string; seat: string;
  tier: Tier; faceValueSkr: number; checkedInAt?: string | null;
};
export type BondView = {
  assetId: string; seller: string; to: string; priceSkr: number; amount: number;
  status: 'pending' | 'locked' | 'returned' | 'slashed' | 'cancelled'; ts: number;
  eventName: string; venue: string; date: string; seat: string;
};
export type Check = { key?: string; label: string; state: 'pass' | 'fail' | 'skip'; ok?: boolean; detail?: string };
export type VerifyResult = {
  approved: boolean; headline: string; label?: string; checks: Check[]; ms: number;
  ticket?: { assetId: string; seat: string; event?: string; tier: Tier; owner: string };
};
export type Config = {
  mock: boolean; bondAmount: number; vipAmount: number; stakeAmount: number;
};

export const api = {
  config: () => call<Config>('/api/config'),
  events: () => call<EventInfo[]>('/api/events'),
  orgEvents: () => call<{ id: string; name: string; faceValueSkr: number; minted: number; capacity: number }[]>('/api/org/events', undefined, true),
  mintNew: (recipientAddress: string, eventName: string, capacity: number, faceValueSkr: number, tier: Tier, venue?: string, startsAt?: string) =>
    post<{ assetId: string | null; seat: string; eventId: string }>('/api/tickets/mint', { recipientAddress, eventName, capacity, faceValueSkr, tier, venue, startsAt }, true),
  tree: () => call<{ tree: string; minted: number; capacity: number; maxDepth: number; maxBufferSize: number }>('/api/tree', undefined, true),
  tickets: (owner: string) => call<Ticket[]>(`/api/tickets/${owner}`),
  ticket: (assetId: string) => call<{ assetId: string; checkedInAt: string | null; tier: Tier }>(`/api/ticket/${assetId}`),
  transfers: (wallet: string) => call<BondView[]>(`/api/transfers/${wallet}`),
  balance: (w: string) => call<{ balance: number }>(`/api/balance/${w}`),
  faucet: (wallet: string) => post<{ amount: number }>('/api/faucet', { wallet }),
  relay: (tx: string) => post<{ signature: string }>('/api/relay', { tx }),

  prepareTransfer: (assetId: string, from: string, to: string, priceSkr: number) =>
    post<{ bondTx: string; transferTx: string; bondAmount: number }>('/api/transfer/prepare', { assetId, from, to, priceSkr }),
  rollbackTransfer: (assetId: string, from: string) => post<{ refunded: boolean }>('/api/transfer/rollback', { assetId, from }),
  prepareVip: (assetId: string, owner: string) => post<{ tx: string }>('/api/vip/prepare', { assetId, owner }),

  // organizer
  orgStatus: (wallet: string) => call<{ staked: boolean; amount: number; required: number }>(`/api/org/status/${wallet}`),
  orgStakePrepare: (wallet: string) => post<{ tx: string }>('/api/org/stake/prepare', { wallet }),
  orgUnstakePrepare: (wallet: string) => post<{ tx: string }>('/api/org/unstake/prepare', { wallet }, true),
  orgLogin: (wallet: string, ts: number, sig: string) => post<{ token: string; exp: number }>('/api/org/login', { wallet, ts, sig }),
  mint: (recipientAddress: string, eventId: string, tier: Tier) =>
    post<{ assetId: string | null; seat: string }>('/api/tickets/mint', { recipientAddress, eventId, tier }, true),
  verify: (qr: string) => post<VerifyResult>('/api/verify', { qr }, true),
  orgBonds: () => call<BondView[]>('/api/org/bonds', undefined, true),
  orgResolve: (assetId: string, slash: boolean) => post<{ signature: string }>('/api/org/bond/resolve', { assetId, slash }, true),
};
