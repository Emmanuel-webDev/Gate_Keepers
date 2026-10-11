import 'dotenv/config';
import os from 'os';
import path from 'path';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k} (see .env.example)`);
  return v;
};

const expand = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

export const env = {
  port: Number(process.env.PORT ?? 8787),
  rpcUrl: `https://devnet.helius-rpc.com/?api-key=${need('HELIUS_API_KEY')}`,
  programId: need('PROGRAM_ID'),
  keypairPath: expand(process.env.KEYPAIR_PATH ?? '~/.config/solana/id.json'),
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
};

export const SKR_DECIMALS = 6;
export const BOND_AMOUNT = 250n * 10n ** BigInt(SKR_DECIMALS); // 250 SKR
export const VIP_AMOUNT = 500n * 10n ** BigInt(SKR_DECIMALS); // 500 SKR
export const STAKE_AMOUNT = 1000n * 10n ** BigInt(SKR_DECIMALS); // organizer stake: 1,000 test SKR on devnet
export const TREE_DEPTH = 14;
export const TREE_CAPACITY = 2 ** TREE_DEPTH; // 16,384
export const toSkr = (n: bigint) => Number(n) / 10 ** SKR_DECIMALS;
export const QR_WINDOW_MS = 60_000;
