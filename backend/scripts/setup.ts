/**
 * One-time devnet bootstrap (run AFTER you deployed the Anchor program and filled .env):
 *   1. creates the mock "tSKR" mint (devnet has no real SKR)
 *   2. creates the treasury token account (slashed bonds land here)
 *   3. initialises the on-chain Config (mint, treasury, bond + VIP amounts)
 *   4. creates the Bubblegum merkle tree (depth 14 = 16,384 tickets)
 *   5. writes data/state.json with two demo events
 */
import { createMint, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { generateSigner } from '@metaplex-foundation/umi';
import { createTree } from '@metaplex-foundation/mpl-bubblegum';
import { connection, payer, sendAsBackend, umi } from '../src/chain';
import { BOND_AMOUNT, SKR_DECIMALS, STAKE_AMOUNT, TREE_DEPTH, VIP_AMOUNT } from '../src/config';
import { configPda, initializeIx, initStakeConfigIx, PROGRAM_ID, stakeCfgPda } from '../src/program';
import { saveState } from '../src/state';

(async () => {
  console.log('Backend wallet:', payer.publicKey.toBase58());
  const sol = (await connection.getBalance(payer.publicKey)) / 1e9;
  console.log('Balance:', sol.toFixed(2), 'SOL');
  if (sol < 0.5) throw new Error('Need ~0.5+ devnet SOL. Run: solana airdrop 2 --url devnet (or use faucet.solana.com)');

  const prog = await connection.getAccountInfo(PROGRAM_ID);
  if (!prog?.executable) throw new Error(`Program ${PROGRAM_ID.toBase58()} is not deployed on devnet`);

  console.log('Creating tSKR mint...');
  const mint = await createMint(connection, payer, payer.publicKey, null, SKR_DECIMALS);
  const treasury = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);

  if (!(await connection.getAccountInfo(configPda()))) {
    console.log('Initialising program config...');
    await sendAsBackend([
      initializeIx({ authority: payer.publicKey, skrMint: mint, treasury: treasury.address, bondAmount: BOND_AMOUNT, vipAmount: VIP_AMOUNT }),
    ]);
  } else {
    throw new Error('Program Config already exists (setup was run before). Keep your data/state.json, or redeploy the program under a new ID to start fresh.');
  }

  if (!(await connection.getAccountInfo(stakeCfgPda()))) {
    console.log('Initialising organizer stake settings...');
    await sendAsBackend([initStakeConfigIx({ authority: payer.publicKey, skrMint: mint, amount: STAKE_AMOUNT })]);
  }

  console.log('Creating merkle tree...');
  const merkleTree = generateSigner(umi);
  await (await createTree(umi, { merkleTree, maxDepth: TREE_DEPTH, maxBufferSize: 64 })).sendAndConfirm(umi);

  saveState({
    skrMint: mint.toBase58(),
    treasury: treasury.address.toBase58(),
    tree: merkleTree.publicKey,
    minted: {},
    tickets: {},
    holders: {},
    bonds: [],
    events: [],
  });
  console.log('\nDone. tSKR mint:', mint.toBase58(), '\nTree:', merkleTree.publicKey, '\nNext: npm run dev');
})().catch((e) => { console.error(e); process.exit(1); });
