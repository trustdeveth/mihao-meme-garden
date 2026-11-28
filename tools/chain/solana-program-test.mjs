// The Solana program on a private local network, with both kinds of token. Nothing public.
//   1. build:  chain/scripts/build.sh and build.sh --test   (in WSL)
//   2. run:    node tools/chain/solana-program-test.mjs      (starts and stops its own local validator)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createInitializeMintInstruction, getOrCreateAssociatedTokenAccount, setAuthority, AuthorityType, getAccount,
  ExtensionType, getMintLen, createInitializeTransferFeeConfigInstruction, createInitializePermanentDelegateInstruction, createInitializeTransferHookInstruction,
  createInitializeMetadataPointerInstruction, createInitializeNonTransferableMintInstruction,
} from '@solana/spl-token';
import * as P from '../../shared/src/chain/program.js';
import { startValidator, mint2022, makeToken as newToken, wait } from './local-net.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROGRAM = readFileSync(resolve(ROOT, 'chain/target/deploy/program-id.txt'), 'utf8').trim();
const A = P.pdas(PROGRAM);
const step = (s) => console.log(`  - ${s}`);

// the same leaf as the Rust test (printed by `cargo test leaf_vector`)
{
  const pk = (n) => new PublicKey(new Uint8Array(32).fill(n));
  assert.equal(P.toHex(P.leafHash(pk(7), pk(9), 7, 3, pk(4), 1_234_567)), 'b8885da0677f2ebb96802b72393e42acaf0e6221a3d394a5bbeac722749b5348');
  console.log('JavaScript and Rust hash a reward the same way');
}

async function scenario(kind, tokenProgram, decimals) {
  console.log(`\n${kind}, ${decimals} decimals`);
  const admin = Keypair.generate(), alice = Keypair.generate(), bob = Keypair.generate();
  const net = await startValidator(admin.publicKey);
  const { conn } = net;
  try {
    for (const [k, sol] of [[admin, 20], [alice, 5], [bob, 5]]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL), 'confirmed');
    const send = (signers, ...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' });
    const refused = async (promise, pattern, what) => {
      try { await promise; } catch (e) { const text = `${e.message} ${(e.logs ?? e.transactionLogs ?? []).join(' ')}`; assert.match(text, pattern, `${what}: refused for another reason: ${text.slice(0, 600)}`); return; }
      assert.fail(`${what}: should have been refused`);
    };
    const UNIT = 10n ** BigInt(decimals);
    const holding = async (account) => (await getAccount(conn, account, 'confirmed', tokenProgram)).amount;

    // the token, made the way the test says, with the admin as its first holder
    const makeToken = (options = {}) => newToken(conn, admin, { tokenProgram, decimals, ...options });
    const initWith = (mint, treasury, who = admin) => send([who], P.initializeIx({ programId: PROGRAM, admin: who.publicKey, mint, treasury, tokenProgram, recycleBps: 5000 }));

    // 1. only the deploy wallet can set the program up
    const { mint, mine } = await makeToken();
    const bobsView = await getOrCreateAssociatedTokenAccount(conn, bob, mint, bob.publicKey, false, 'confirmed', undefined, tokenProgram);
    await refused(initWith(mint, bobsView.address, bob), /Only the admin|NotAdmin/, 'a stranger setting the program up with their own treasury');
    step('a stranger cannot set the program up before the owner does');

    // 2. tokens whose rules could hurt players are refused
    const open = await makeToken({ revoke: false });
    await refused(initWith(open.mint, open.mine), /MintAuthority|mint authority/, 'a token that can still be minted');
    const freezable = await makeToken({ freeze: admin.publicKey });
    await refused(initWith(freezable.mint, freezable.mine), /FreezeAuthority|freeze authority/, 'a token that can be frozen');
    if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      const risky = {
        'a transfer fee': [ExtensionType.TransferFeeConfig, (m) => createInitializeTransferFeeConfigInstruction(m, admin.publicKey, admin.publicKey, 100, 1_000_000n, TOKEN_2022_PROGRAM_ID)],
        'a permanent delegate': [ExtensionType.PermanentDelegate, (m) => createInitializePermanentDelegateInstruction(m, admin.publicKey, TOKEN_2022_PROGRAM_ID)],
        'a transfer hook': [ExtensionType.TransferHook, (m) => createInitializeTransferHookInstruction(m, admin.publicKey, Keypair.generate().publicKey, TOKEN_2022_PROGRAM_ID)],
        'no transfers': [ExtensionType.NonTransferable, (m) => createInitializeNonTransferableMintInstruction(m, TOKEN_2022_PROGRAM_ID)],
      };
      for (const [what, [extension, make]] of Object.entries(risky)) {
        const bad = await mint2022(conn, admin, decimals, [extension], (m) => [make(m)]);
        const account = await getOrCreateAssociatedTokenAccount(conn, admin, bad, admin.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID);
        await setAuthority(conn, admin, bad, admin, AuthorityType.MintTokens, null, [], undefined, TOKEN_2022_PROGRAM_ID);
        await refused(initWith(bad, account.address), /TokenRules|extra rules/, `a token with ${what}`);
      }
      step('refused: Token-2022 tokens with a transfer fee, permanent delegate, transfer hook or no transfers');
    }
    step('refused: a token that can still be minted or frozen');

    const info = P.mintInfo(await conn.getAccountInfo(mint));
    assert.equal(info.decimals, decimals);
    assert.ok(info.tokenProgram.equals(tokenProgram));
    await initWith(mint, mine);
    await refused(initWith(mint, mine), /already in use|0x0/, 'setting it up twice');
    step('the owner names the token, once');

    // 3. weekly rewards
    const T = { programId: PROGRAM, mint, tokenProgram };
    const wallet = async (who) => (await getOrCreateAssociatedTokenAccount(conn, admin, mint, who.publicKey, false, 'confirmed', undefined, tokenProgram)).address;
    const aliceAta = await wallet(alice), bobAta = await wallet(bob);
    const give = (to, tokens) => send([admin], P.tokenTransferIx({ from: mine, to, owner: admin.publicKey, mint, tokenProgram, decimals, amount: BigInt(tokens) * UNIT }));
    const leaves = [P.leafHash(PROGRAM, mint, 1, 0, alice.publicKey, 1000n * UNIT), P.leafHash(PROGRAM, mint, 1, 1, bob.publicKey, 500n * UNIT)];
    const tree = P.buildTree(leaves);
    const now = async () => Number(await conn.getBlockTime(await conn.getSlot()));
    const deadline = (await now()) + 20;
    const openIx = (who) => P.openEpochIx({ programId: PROGRAM, admin: who.publicKey, epochId: 1, root: tree.root, total: 1500n * UNIT, claimDeadline: deadline });
    await refused(send([admin], openIx(admin)), /VaultUnderfunded|does not hold enough/, 'opening a week without funds');
    await give(A.vault, 5000);
    await refused(send([bob], openIx(bob)), /Only the admin|NotAdmin/, 'a stranger publishing a week');
    await send([admin], openIx(admin));
    const claim = (who, index, amount, proof = tree.proof(index)) => P.claimIx({ ...T, payer: who.publicKey, claimant: who.publicKey, epochId: 1, index, amount, proof });
    await refused(send([alice], claim(alice, 0, 2000n * UNIT)), /BadProof|Invalid proof/, 'a larger amount');
    await refused(send([bob], claim(bob, 0, 1000n * UNIT)), /BadProof|Invalid proof/, "someone else's reward");
    await send([alice], claim(alice, 0, 1000n * UNIT));
    assert.equal(await holding(aliceAta), 1000n * UNIT);
    await refused(send([alice], claim(alice, 0, 1000n * UNIT)), /already in use|0x0/, 'claiming twice');
    step('rewards: the right wallet claims its exact amount once');

    // 4. shop payments: half back to the rewards, half to the treasury, one payment per order
    const orderId = '00112233445566778899aabbccddeeff';
    const quoteEnds = (await now()) + 120;
    const pay = (deadline = quoteEnds) => P.payOrderIx({ ...T, payer: alice.publicKey, treasury: mine, orderId, amount: 101n, deadline });
    await refused(send([alice], pay((await now()) - 5)), /QuoteExpired|quote has expired/, 'paying after the quote ran out');
    // someone who sees the order id pays one unit with it first: it must not block the real buyer
    await give(bobAta, 1);
    await send([bob], P.payOrderIx({ ...T, payer: bob.publicKey, treasury: mine, orderId, amount: 1n, deadline: quoteEnds }));
    const [vaultBefore, treasuryBefore] = [await holding(A.vault), await holding(mine)];
    await send([alice], pay());
    assert.equal((await holding(A.vault)) - vaultBefore, 50n);
    assert.equal((await holding(mine)) - treasuryBefore, 51n);
    const receipt = P.decodeOrder((await conn.getAccountInfo(A.order(alice.publicKey, P.fromHex(orderId)))).data);
    assert.ok(receipt.payer.equals(alice.publicKey));
    assert.equal(receipt.amount, 101n);
    await refused(send([alice], pay()), /already in use|0x0/, 'paying an order twice');
    await refused(send([bob], P.payOrderIx({ ...T, payer: bob.publicKey, treasury: bobAta, orderId: 'ff'.repeat(16), amount: 1n, deadline: quoteEnds })), /ConstraintHasOne|has one|2001/i, 'paying a treasury of your own');
    step('shop: split, recorded, never twice or redirected; late quotes refused; a copied order id blocks nobody');

    // 5. Garden Club (test build: a lock "day" lasts one second)
    const held = await holding(aliceAta);
    await send([alice], P.clubLockIx({ ...T, owner: alice.publicKey, amount: 300n * UNIT, days: 6 }));
    assert.equal(P.decodeLock((await conn.getAccountInfo(A.lock(alice.publicKey))).data).amount, 300n * UNIT);
    await refused(send([alice], P.clubUnlockIx({ ...T, owner: alice.publicKey })), /StillLocked|not ended/, 'unlocking early');
    await send([admin], P.updateConfigIx({ programId: PROGRAM, admin: admin.publicKey, paused: true }));
    await refused(send([bob], claim(bob, 1, 500n * UNIT)), /Paused|are paused/, 'claiming while paused');
    await wait(8000);
    await send([alice], P.clubUnlockIx({ ...T, owner: alice.publicKey }));
    assert.equal(await holding(aliceAta), held);
    await send([admin], P.updateConfigIx({ programId: PROGRAM, admin: admin.publicKey, paused: false }));
    step('Garden Club: locked tokens come back in full, only after the lock, even while paused');

    // 6. reserved funds, deadline, handing over the admin
    const state = async () => P.decodeConfig((await conn.getAccountInfo(A.config)).data);
    const free = (await holding(A.vault)) - (await state()).outstanding;
    const withdraw = (who, amount) => P.withdrawUnreservedIx({ ...T, admin: who.publicKey, to: mine, amount });
    await refused(send([admin], withdraw(admin, free + 1n)), /Reserved|reserved/, 'withdrawing reserved funds');
    await refused(send([bob], withdraw(bob, 1n)), /Only the admin|NotAdmin/, 'a stranger withdrawing');
    await send([admin], withdraw(admin, free));
    await refused(send([admin], P.closeEpochIx({ programId: PROGRAM, admin: admin.publicKey, epochId: 1 })), /NotExpired|not ended/, 'closing early');
    while ((await now()) <= deadline + 1) await wait(1000);
    await refused(send([bob], claim(bob, 1, 500n * UNIT)), /ClaimExpired|has ended/, 'claiming too late');
    await send([admin], P.closeEpochIx({ programId: PROGRAM, admin: admin.publicKey, epochId: 1 }));
    assert.equal((await state()).outstanding, 0n);
    await send([admin], P.proposeAdminIx({ programId: PROGRAM, admin: admin.publicKey, newAdmin: bob.publicKey }));
    await refused(send([alice], P.acceptAdminIx({ programId: PROGRAM, newAdmin: alice.publicKey })), /Only the admin|NotAdmin/, 'someone else accepting');
    await send([bob], P.acceptAdminIx({ programId: PROGRAM, newAdmin: bob.publicKey }));
    assert.ok((await state()).admin.equals(bob.publicKey));
    await refused(send([admin], P.updateConfigIx({ programId: PROGRAM, admin: admin.publicKey, paused: true })), /Only the admin|NotAdmin/, 'the old admin');
    step('reserved funds are protected, claims end on time, and the admin role moves in two steps');
  } finally { await net.stop(); }
}

await scenario('Classic Solana token', TOKEN_PROGRAM_ID, 6);
await scenario('Token-2022 token', TOKEN_2022_PROGRAM_ID, 9);
console.log('\nSOLANA PROGRAM TEST OK');
process.exit(0);
