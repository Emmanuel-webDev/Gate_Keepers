const web3 = require('@solana/web3.js');
const fs = require('fs');
const keypair = web3.Keypair.generate();
fs.writeFileSync('id.json', JSON.stringify(Array.from(keypair.secretKey)));
console.log(keypair.publicKey.toBase58());
