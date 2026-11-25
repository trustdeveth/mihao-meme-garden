// Start the game (same as `npm run dev`) with the MGRD features pointed at your BNB testnet deployment, which
// `npm run chain:admin -- deploy` records in chain/deployment-bsc-testnet.json.
// Optional: MG_CHAIN_RPC=<your RPC URL> (default: the public testnet RPC). Prices: shared/src/data/mgrd.js.
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const file = new URL('../chain/deployment-bsc-testnet.json', import.meta.url);
if (!existsSync(file)) {
  console.error('No testnet deployment yet. See chain/README.md, "Try it on BNB testnet".');
  process.exit(1);
}
const d = JSON.parse(readFileSync(file, 'utf8'));
if (!d.token) {
  console.error('The testnet contract has no token yet. See chain/README.md (set-token).');
  process.exit(1);
}
const env = { ...process.env, MG_CHAIN_CLUSTER: 'bsc-testnet', MG_REWARDS_CONTRACT: d.rewards, MG_MGRD_TOKEN: d.token, MG_TREASURY: d.treasury };
console.log(`MGRD on BNB testnet: rewards ${d.rewards}, token ${d.token}`);
spawn(process.execPath, [fileURLToPath(new URL('./dev.mjs', import.meta.url))], { stdio: 'inherit', env });
