import fs from 'fs';
import path from 'path';

const defaultData = path.join(__dirname, '..', 'data');
export const getDataDir = () => (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : defaultData);
export const dataDir = defaultData;
export const metadataDir = path.join(defaultData, 'metadata');

export type EventInfo = {
  id: string;
  name: string;
  short: string; // used in the on-chain asset name (32 char limit)
  venue: string;
  date: string; // ISO
  faceValueSkr: number;
  image: string;
  createdBy?: string; // organizer wallet
  capacity?: number;
  tree?: string; // per-event Bubblegum tree (falls back to state.tree)
  perWalletLimit?: number; // default 1
};

export type Tier = 'General' | 'VIP Access';
export type TicketRec = {
  eventId: string; seat: string; tier: Tier; mintedBy?: string;
  recipient?: string; signature?: string; pendingAssetId?: boolean; // pending: keyed by `sig:<signature>`
  checkedInAt?: string; // ISO string
  checkedInBy?: string; // organizer wallet
  voidedAt?: string; // ISO string
  reason?: string;
};

export type BondStatus = 'pending' | 'locked' | 'returned' | 'slashed' | 'cancelled';
export type BondRec = {
  assetId: string;
  seller: string;
  to: string;
  priceSkr: number;
  amount: number; // SKR locked
  status: BondStatus;
  ts: number;
};

export type HolderRec = {
  holder: string;
  pending?: { to: string; at: number; bondSeen?: boolean };
};

export type State = {
  skrMint: string;
  treasury: string;
  tree: string;
  events: EventInfo[];
  minted: Record<string, number>; // eventId -> count
  tickets: Record<string, TicketRec>; // assetId -> mint info
  holders: Record<string, HolderRec>; // assetId -> legitimate holder record
  bonds: BondRec[];
};

let cache: State | null = null;
let lastDataDir: string | null = null;

export function loadState(): State {
  const currentDir = getDataDir();
  if (cache && lastDataDir === currentDir) return cache;
  const stateFile = path.join(currentDir, 'state.json');
  if (!fs.existsSync(stateFile)) throw new Error(`state.json missing in ${currentDir}. Run \`npm run setup\` first.`);
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as State;
  s.tickets ??= {};
  s.holders ??= {};
  s.bonds ??= [];
  cache = s;
  lastDataDir = currentDir;
  return s;
}

export function saveState(s: State) {
  const currentDir = getDataDir();
  cache = s;
  lastDataDir = currentDir;
  fs.mkdirSync(currentDir, { recursive: true });
  fs.writeFileSync(path.join(currentDir, 'state.json'), JSON.stringify(s, null, 2));
}

/** True if the tree is the legacy shared tree or any per-event tree. */
export function isGateKeeperTree(tree: string | undefined | null): boolean {
  if (!tree) return false;
  const s = loadState();
  return tree === s.tree || s.events.some((e) => e.tree === tree);
}

// ---- check-ins (assetId -> unix ms). Persisted so a restart can't re-admit a ticket.
let checkinsCache: Record<string, number> | null = null;
let lastCheckinsDir: string | null = null;

function loadCheckins(): Record<string, number> {
  const file = path.join(getDataDir(), 'checkins.json');
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }
  return {};
}

export const getCheckin = (assetId: string) => {
  const currentDir = getDataDir();
  if (!checkinsCache || lastCheckinsDir !== currentDir) {
    checkinsCache = loadCheckins();
    lastCheckinsDir = currentDir;
  }
  return checkinsCache[assetId];
};

export function setCheckin(assetId: string) {
  const currentDir = getDataDir();
  if (!checkinsCache || lastCheckinsDir !== currentDir) {
    checkinsCache = loadCheckins();
    lastCheckinsDir = currentDir;
  }
  checkinsCache[assetId] = Date.now();
  fs.mkdirSync(currentDir, { recursive: true });
  fs.writeFileSync(path.join(currentDir, 'checkins.json'), JSON.stringify(checkinsCache));
}
