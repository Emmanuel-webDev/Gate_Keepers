import { Router } from 'express';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { connection, pk } from '../chain';
import { BOND_AMOUNT, SKR_DECIMALS, STAKE_AMOUNT, TREE_CAPACITY, TREE_DEPTH, VIP_AMOUNT, toSkr } from '../config';
import { requireOrganizer } from '../auth';
import { loadState } from '../state';

export const info = Router();

info.get('/config', (_req, res) => {
  const s = loadState();
  res.json({
    cluster: 'devnet',
    skrMint: s.skrMint,
    skrDecimals: SKR_DECIMALS,
    mock: true, // devnet uses a test SKR. The program takes the mint as config, so mainnet swaps in the real one.
    bondAmount: toSkr(BOND_AMOUNT),
    vipAmount: toSkr(VIP_AMOUNT),
    stakeAmount: toSkr(STAKE_AMOUNT),
  });
});

info.get('/events', (_req, res) => {
  const s = loadState();
  res.json(s.events.map((e) => ({ ...e, minted: s.minted[e.id] ?? 0 })));
});

info.get('/tree', requireOrganizer, (_req, res) => {
  const s = loadState();
  res.json({
    tree: s.tree,
    minted: Object.values(s.minted).reduce((a, b) => a + b, 0),
    capacity: TREE_CAPACITY,
    maxDepth: TREE_DEPTH,
    maxBufferSize: 64,
  });
});

info.get('/balance/:wallet', async (req, res, next) => {
  try {
    const s = loadState();
    const ata = getAssociatedTokenAddressSync(pk(s.skrMint), pk(req.params.wallet, 'wallet'));
    const bal = await connection.getTokenAccountBalance(ata).catch(() => null);
    res.json({ balance: bal ? Number(bal.value.uiAmount ?? 0) : 0 });
  } catch (e) { next(e); }
});
