// Start the game (same as `npm run dev`) with the MGRD features pointed at the devnet deployment in chain/devnet.json.
// Optional: MG_CHAIN_RPC=<your devnet RPC URL> (default: the public devnet RPC). Prices: shared/src/data/mgrd.js.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const d = JSON.parse(readFileSync(new URL('../chain/devnet.json', import.meta.url), 'utf8'));
const env = {
  ...process.env,
  MG_PROGRAM_ID: d.programId, MG_MGRD_MINT: d.mint, MG_TREASURY: d.treasury, MG_CHAIN_CLUSTER: 'devnet',
  MG_CHAIN_RPC: process.env.MG_CHAIN_RPC ?? 'https://api.devnet.solana.com',
};
console.log(`MGRD on devnet: program ${d.programId}, mint ${d.mint}`);
spawn(process.execPath, [new URL('./dev.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { stdio: 'inherit', env });
