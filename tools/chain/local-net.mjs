// Starts a throwaway Solana network (in WSL) with the test build of the program, for the two chain tests.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createMint, createInitializeMintInstruction, createInitializeMetadataPointerInstruction, getOrCreateAssociatedTokenAccount,
  mintTo, setAuthority, AuthorityType, ExtensionType, getMintLen,
} from '@solana/spl-token';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RPC = 'http://127.0.0.1:8899';
export const programId = () => readFileSync(resolve(ROOT, 'chain/target/deploy/program-id.txt'), 'utf8').trim();
const wslPath = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replaceAll('\\', '/');
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `authority` is the wallet allowed to upgrade (and so to set up) the program. */
export async function startValidator(authority) {
  try { await new Connection(RPC).getSlot(); throw new Error(`something is already listening on ${RPC}`); } catch (e) { if (/already listening/.test(e.message)) throw e; }
  const child = spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', wslPath(resolve(ROOT, 'chain/scripts/local-validator.sh')), authority.toBase58(), '--test'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (d) => { errors += String(d).replaceAll('\0', ''); });
  const conn = new Connection(RPC, 'confirmed');
  const stop = async () => { try { execFileSync('wsl.exe', ['-d', 'Ubuntu', '--', 'pkill', '-f', 'solana-test-validator']); } catch { /* already gone */ } child.kill(); await wait(2500); };
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error(`the local validator stopped: ${errors.slice(-800)}`);
    try { if ((await conn.getSlot()) > 1) return { conn, stop }; } catch { /* not up yet */ }
    await wait(1000);
  }
  await stop();
  throw new Error(`no local validator: ${errors.slice(-800)}`);
}

export async function airdrop(conn, who, sol = 5) { await conn.confirmTransaction(await conn.requestAirdrop(who.publicKey, sol * LAMPORTS_PER_SOL), 'confirmed'); }

/** A Token-2022 mint with the given extensions, set up like a launchpad would. */
export async function mint2022(conn, payer, decimals, extensions, setupIx) {
  const mint = Keypair.generate();
  const space = getMintLen(extensions);
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space, lamports: await conn.getMinimumBalanceForRentExemption(space), programId: TOKEN_2022_PROGRAM_ID }),
    ...setupIx(mint.publicKey),
    createInitializeMintInstruction(mint.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
  ), [payer, mint]);
  return mint.publicKey;
}

/** A test token: 1,000,000,000 held by `owner`. A launched token has its minting revoked and no freeze authority. */
export async function makeToken(conn, owner, { tokenProgram = TOKEN_PROGRAM_ID, decimals = 6, revoke = true, freeze = null } = {}) {
  const mint = tokenProgram.equals(TOKEN_2022_PROGRAM_ID) && !freeze
    // like a launchpad token: Token-2022 with only the name-and-picture extension
    ? await mint2022(conn, owner, decimals, [ExtensionType.MetadataPointer], (m) => [createInitializeMetadataPointerInstruction(m, owner.publicKey, m, TOKEN_2022_PROGRAM_ID)])
    : await createMint(conn, owner, owner.publicKey, freeze, decimals, undefined, undefined, tokenProgram);
  const mine = await getOrCreateAssociatedTokenAccount(conn, owner, mint, owner.publicKey, false, 'confirmed', undefined, tokenProgram);
  await mintTo(conn, owner, mint, mine.address, owner, 1_000_000_000n * 10n ** BigInt(decimals), [], undefined, tokenProgram);
  if (revoke) await setAuthority(conn, owner, mint, owner, AuthorityType.MintTokens, null, [], undefined, tokenProgram);
  return { mint, mine: mine.address };
}
