import { Router } from 'express';
import {
  createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { HttpError, payer, pk, sendAsBackend } from '../chain';
import { SKR_DECIMALS } from '../config';
import { loadState } from '../state';

export const faucet = Router();

const GRANT = 1000n * 10n ** BigInt(SKR_DECIMALS);
const MAX_GRANTS_PER_WALLET = 10;
const grants = new Map<string, number>();

/** Devnet has no real SKR, so judges get free mock tSKR here. Backend is the mint authority. */
faucet.post('/faucet', async (req, res, next) => {
  try {
    const wallet = pk(req.body?.wallet, 'wallet');
    const n = grants.get(wallet.toBase58()) ?? 0;
    if (n >= MAX_GRANTS_PER_WALLET) throw new HttpError(429, 'Faucet limit reached for this wallet');

    const mint = pk(loadState().skrMint);
    const ata = getAssociatedTokenAddressSync(mint, wallet);
    const signature = await sendAsBackend([
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, wallet, mint),
      createMintToInstruction(mint, ata, payer.publicKey, GRANT),
    ]);
    grants.set(wallet.toBase58(), n + 1);
    res.json({ signature, amount: Number(GRANT) / 10 ** SKR_DECIMALS });
  } catch (e) { next(e); }
});
