import { connection } from '../src/chain';
import { configPda } from '../src/program';
import { PublicKey } from '@solana/web3.js';
(async () => {
  const info = await connection.getAccountInfo(configPda());
  if (info) {
    const auth = new PublicKey(info.data.subarray(8, 40));
    console.log('Authority:', auth.toBase58());
  } else {
    console.log('No config pda');
  }
})();
