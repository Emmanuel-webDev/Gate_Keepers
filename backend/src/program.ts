// Hand-rolled instruction builders for the Anchor program (no IDL needed, so the backend
// works the moment the program is deployed). Discriminator = sha256("global:<ix_name>")[0..8].
import { createHash } from 'crypto';
import {
  PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { env } from './config';
import { connection } from './chain';

export const PROGRAM_ID = new PublicKey(env.programId);

const disc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };

const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const configPda = () => pda(Buffer.from('config'));
export const vaultPda = () => pda(Buffer.from('vault'));
export const bondPda = (asset: PublicKey) => pda(Buffer.from('bond'), asset.toBuffer());
export const vipPda = (asset: PublicKey) => pda(Buffer.from('vip'), asset.toBuffer());

const meta = (pubkey: PublicKey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });

export function initializeIx(a: {
  authority: PublicKey; skrMint: PublicKey; treasury: PublicKey; bondAmount: bigint; vipAmount: bigint;
}) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.authority, true, true), meta(configPda(), false, true), meta(a.skrMint), meta(a.treasury),
      meta(vaultPda(), false, true), meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(SYSVAR_RENT_PUBKEY),
    ],
    data: Buffer.concat([disc('initialize'), u64(a.bondAmount), u64(a.vipAmount)]),
  });
}

export function lockBondIx(a: { payer: PublicKey; seller: PublicKey; asset: PublicKey; sellerToken: PublicKey }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.payer, true, true), meta(a.seller, true, true), meta(configPda()), meta(bondPda(a.asset), false, true),
      meta(a.sellerToken, false, true), meta(vaultPda(), false, true), meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
    ],
    data: Buffer.concat([disc('lock_transfer_bond'), a.asset.toBuffer()]),
  });
}

export function resolveBondIx(a: { authority: PublicKey; asset: PublicKey; destination: PublicKey; slash: boolean }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.authority, true, true), meta(configPda()), meta(bondPda(a.asset), false, true),
      meta(vaultPda(), false, true), meta(a.destination, false, true), meta(TOKEN_PROGRAM_ID),
    ],
    data: Buffer.concat([disc('resolve_bond'), Buffer.from([a.slash ? 1 : 0])]),
  });
}

export function burnVipIx(a: {
  payer: PublicKey; owner: PublicKey; asset: PublicKey; skrMint: PublicKey; ownerToken: PublicKey;
}) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.payer, true, true), meta(a.owner, true, false), meta(configPda()), meta(vipPda(a.asset), false, true),
      meta(a.skrMint, false, true), meta(a.ownerToken, false, true), meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
    ],
    data: Buffer.concat([disc('burn_for_vip'), a.asset.toBuffer()]),
  });
}

/** Bond account layout: 8 disc | seller 32 | asset 32 | amount u64 | created_at i64 | bump */
export async function fetchBond(asset: PublicKey) {
  const info = await connection.getAccountInfo(bondPda(asset));
  if (!info) return null;
  return {
    seller: new PublicKey(info.data.subarray(8, 40)),
    asset: new PublicKey(info.data.subarray(40, 72)),
    amount: info.data.readBigUInt64LE(72),
  };
}

export const hasVip = async (asset: PublicKey) => (await connection.getAccountInfo(vipPda(asset))) !== null;

// ------------------------------------------------------------------ organizer stake
export const stakeCfgPda = () => pda(Buffer.from('stake_cfg'));
export const stakeVaultPda = () => pda(Buffer.from('stake_vault'));
export const organizerPda = (owner: PublicKey) => pda(Buffer.from('organizer'), owner.toBuffer());

export function initStakeConfigIx(a: { authority: PublicKey; skrMint: PublicKey; amount: bigint }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.authority, true, true), meta(configPda()), meta(stakeCfgPda(), false, true), meta(a.skrMint),
      meta(stakeVaultPda(), false, true), meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(SYSVAR_RENT_PUBKEY),
    ],
    data: Buffer.concat([disc('init_stake_config'), u64(a.amount)]),
  });
}

export function stakeOrganizerIx(a: { payer: PublicKey; organizer: PublicKey; organizerToken: PublicKey }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.payer, true, true), meta(a.organizer, true, false), meta(configPda()), meta(stakeCfgPda()),
      meta(organizerPda(a.organizer), false, true), meta(a.organizerToken, false, true),
      meta(stakeVaultPda(), false, true), meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
    ],
    data: disc('stake_organizer'),
  });
}

export function unstakeOrganizerIx(a: { organizer: PublicKey; organizerToken: PublicKey }) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(a.organizer, true, true), meta(configPda()), meta(organizerPda(a.organizer), false, true),
      meta(a.organizerToken, false, true), meta(stakeVaultPda(), false, true), meta(TOKEN_PROGRAM_ID),
    ],
    data: disc('unstake_organizer'),
  });
}

/** OrganizerStake layout: 8 disc | owner 32 | amount u64 | staked_at i64 | bump */
export async function fetchOrganizerStake(owner: PublicKey) {
  const info = await connection.getAccountInfo(organizerPda(owner));
  return info ? { amount: info.data.readBigUInt64LE(40) } : null;
}
