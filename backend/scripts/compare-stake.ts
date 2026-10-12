import { Connection, PublicKey } from '@solana/web3.js';
import { env, STAKE_AMOUNT, toSkr } from '../src/config';
import { loadState } from '../src/state';

async function main() {
  const walletStr = '4BdmwiVZKSKUn5R5ctjqi59CHnyeepDTrT5Pv9G1YDVg';
  const wallet = new PublicKey(walletStr);

  // 1. Local configuration
  const localState = loadState();
  const localRpcUrl = env.rpcUrl;
  const localCluster = 'devnet';
  const localProgId = new PublicKey(env.programId);
  const localSkrMint = new PublicKey(localState.skrMint);

  const [localStakeCfg] = PublicKey.findProgramAddressSync([Buffer.from('stake_cfg')], localProgId);
  const [localOrganizerStake] = PublicKey.findProgramAddressSync([Buffer.from('organizer'), wallet.toBuffer()], localProgId);

  // 2. Query hosted backend
  const hostedConfigRes = await fetch('https://gate-keepers.onrender.com/api/config');
  const hostedConfig = await hostedConfigRes.json();

  const hostedStatusRes = await fetch(`https://gate-keepers.onrender.com/api/org/status/${walletStr}`);
  const hostedStatus = await hostedStatusRes.json();

  // The hosted program ID (from the Render instructions was 9AgLUBrzQHkaQWyqwtThjAERYKv4tgtnoxrhpSCvZoqM)
  const hostedProgId = new PublicKey('9AgLUBrzQHkaQWyqwtThjAERYKv4tgtnoxrhpSCvZoqM');
  const hostedSkrMint = new PublicKey(hostedConfig.skrMint);

  const [hostedStakeCfg] = PublicKey.findProgramAddressSync([Buffer.from('stake_cfg')], hostedProgId);
  const [hostedOrganizerStake] = PublicKey.findProgramAddressSync([Buffer.from('organizer'), wallet.toBuffer()], hostedProgId);

  // Check on-chain via RPC
  const connection = new Connection(localRpcUrl, 'confirmed');

  const localCfgInfo = await connection.getAccountInfo(localStakeCfg);
  const localStakeInfo = await connection.getAccountInfo(localOrganizerStake);

  const hostedCfgInfo = await connection.getAccountInfo(hostedStakeCfg);
  const hostedStakeInfo = await connection.getAccountInfo(hostedOrganizerStake);

  console.log(JSON.stringify({
    wallet: walletStr,
    local: {
      rpcUrl: localRpcUrl,
      cluster: localCluster,
      programId: localProgId.toBase58(),
      stakeTokenMint: localSkrMint.toBase58(),
      stakeConfigAddress: localStakeCfg.toBase58(),
      stakeConfigExists: !!localCfgInfo,
      organizerStakeAddress: localOrganizerStake.toBase58(),
      organizerStakeExists: !!localStakeInfo,
      organizerStakeAmount: localStakeInfo ? Number(localStakeInfo.data.readBigUInt64LE(40)) / 1e6 : 0,
      stakedStatusResponse: true
    },
    hosted: {
      rpcUrl: 'https://devnet.helius-rpc.com/ (Devnet)',
      cluster: hostedConfig.cluster,
      programId: hostedProgId.toBase58(),
      stakeTokenMint: hostedSkrMint.toBase58(),
      stakeConfigAddress: hostedStakeCfg.toBase58(),
      stakeConfigExists: !!hostedCfgInfo,
      organizerStakeAddress: hostedOrganizerStake.toBase58(),
      organizerStakeExists: !!hostedStakeInfo,
      organizerStakeAmount: hostedStakeInfo ? Number(hostedStakeInfo.data.readBigUInt64LE(40)) / 1e6 : 0,
      stakedStatusResponse: hostedStatus.staked
    }
  }, null, 2));
}

main().catch(console.error);
