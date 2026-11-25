// Runs the game server (8850) and the Vite client (5190) together. Adapted from pactora-app/scripts/dev.mjs.
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';

const win = process.platform === 'win32';
const busy = (port) => new Promise((r) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
for (const port of [8850, 5190]) {
  if (await busy(port)) { console.error(`Port ${port} is already in use. Stop the other process (an older "npm run dev"?) and try again.`); process.exit(1); }
}
const procs = [
  ['server', 'npm run dev -w server'],
  ['client', 'npm run dev -w client'],
].map(([name, cmd]) => {
  const p = spawn(cmd, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const tag = (d) => process.stdout.write(String(d).replace(/^(?=.)/gm, `[${name}] `));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  p.on('exit', (code) => { console.log(`[${name}] exited ${code}`); shutdown(code ?? 1); });
  return p;
});
console.log('Meme Garden: open http://127.0.0.1:5190');
let down = false;
function shutdown(code = 0) {
  if (down) return; down = true;
  for (const p of procs) { try { if (win) execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }); else p.kill('SIGTERM'); } catch { /* gone */ } }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
