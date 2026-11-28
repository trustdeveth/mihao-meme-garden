// Runs the game on this computer with "Connect X" switched on:  npm run dev:x
// With no X app keys it uses a pretend sign-in (this computer only). To try the real one, put these in a file
// called .env.x in the project folder (it is not committed):
//   MG_X_CLIENT_ID=...
//   MG_X_CLIENT_SECRET=...
// and add http://127.0.0.1:5190/api/x/callback as a callback address in the X developer portal.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env.x', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.MG_X_CLIENT_ID) console.log('Connect X: REAL sign-in (keys found).');
else {
  process.env.MG_X_MOCK = '1';
  console.log('Connect X: TEST MODE, a pretend sign-in that works only on this computer.');
}
await import('./dev.mjs');
