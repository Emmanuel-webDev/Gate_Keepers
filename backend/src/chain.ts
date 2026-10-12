import fs from 'fs';
import {
  Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api';
import { env } from './config';

export const connection = new Connection(env.rpcUrl, 'confirmed');

export const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      process.env.KEYPAIR_JSON ?? fs.readFileSync(env.keypairPath, 'utf8'),
    ),
  ),
);

export const umi = createUmi(env.rpcUrl, 'confirmed').use(mplBubblegum()).use(dasApi());
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(payer.secretKey)));

export const pk = (s: string, label = 'address') => {
  try {
    return new PublicKey(s);
  } catch {
    throw new HttpError(400, `Invalid ${label}`);
  }
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Build a tx with the backend as fee payer, signed by the backend only. The user's wallet adds its signature on the phone. */
export async function buildPartialTx(ixs: TransactionInstruction[]): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToLegacyMessage();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  return Buffer.from(tx.serialize()).toString('base64');
}

/** Send a tx that only the backend needs to sign. */
export async function sendAsBackend(ixs: TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToLegacyMessage();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  const sig = await connection.sendTransaction(tx, { preflightCommitment: 'confirmed' });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}
