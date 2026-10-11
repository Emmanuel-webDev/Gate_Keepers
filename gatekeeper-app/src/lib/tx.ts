import { Buffer } from 'buffer';
import { VersionedTransaction } from '@solana/web3.js';
import { api } from './api';

type Signer = (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;

/** Wallet signs all txs in one approval; they are then relayed one by one (each confirmed before the next). */
export async function signAndRelay(signTransactions: Signer, base64Txs: string[]): Promise<string[]> {
  const txs = base64Txs.map((b) => VersionedTransaction.deserialize(Buffer.from(b, 'base64')));
  const signed = await signTransactions(txs);
  const sigs: string[] = [];
  for (const t of signed) {
    const { signature } = await api.relay(Buffer.from(t.serialize()).toString('base64'));
    sigs.push(signature);
  }
  return sigs;
}
