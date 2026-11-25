// $MGRD rewards panel: link a BNB Chain wallet, see this week's Season Points, claim finalized weekly rewards and
// buy MGRD-shop cosmetics. The blockchain library loads only when token features are on (separate chunk).
import { icon, esc, short, checklist, tick } from '../ui/hud.js';
import { mgrdPrice } from '@mg/shared/rules/mgrd';
import { HOLDER_TIERS } from '@mg/shared/data/mgrd';

const api = async (path, body) => {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
  return d;
};
const shortAddr = (a) => (a ? `${a.slice(0, 4)}...${a.slice(-4)}` : '');
const mgrd = (units) => (Number(units) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 2 }); // 18 decimals; for display only
const when = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`; };

const NET_NAMES = { bsc: 'BNB Smart Chain', 'bsc-testnet': 'BNB Smart Chain Testnet', local: 'local test chain' };
const netName = (c) => NET_NAMES[c?.cluster] ?? c?.cluster ?? 'BNB Chain';

/** Wallets to suggest when the browser has none. */
const SUGGESTED = [
  { name: 'MetaMask', url: 'https://metamask.io' },
  { name: 'Trust Wallet', url: 'https://trustwallet.com' },
  { name: 'Binance Wallet', url: 'https://www.binance.com/en/web3wallet' },
];
// browser wallets announce themselves (EIP-6963), so several installed wallets can be told apart
const announced = new Map();
window.addEventListener('eip6963:announceProvider', (e) => {
  const { info, provider } = e.detail ?? {};
  if (info?.rdns && provider?.request) announced.set(info.rdns, { id: info.rdns, name: String(info.name).slice(0, 30), provider });
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
/** Installed BNB Chain wallets (browser extensions or in-app wallet browsers). */
export function installedWallets() {
  if (announced.size) return [...announced.values()];
  const older = window.binancew3w?.ethereum ?? window.ethereum;
  return older?.request ? [{ id: 'injected', name: older.isTrust ? 'Trust Wallet' : older.isMetaMask ? 'MetaMask' : 'Browser wallet', provider: older }] : [];
}
const PICK_KEY = 'mg-wallet';
let chosen = (() => { try { return localStorage.getItem(PICK_KEY); } catch { return null; } })();
function provider() {
  const list = installedWallets();
  return (list.find((x) => x.id === chosen) ?? list[0])?.provider ?? null;
}

/** What the contract's refusals mean, in plain words. */
const REFUSALS = {
  Paused: 'Token features are paused right now.',
  AlreadyClaimed: 'That week has already been claimed.',
  ClaimExpired: 'The claim period has ended.',
  EpochIsClosed: 'That week is closed.',
  UnknownEpoch: 'That week is not open for claims yet.',
  BadProof: 'That reward does not match this wallet.',
  QuoteExpired: 'The price quote ran out. Nothing was paid. Try again.',
  AlreadyPaid: 'That order is already paid.',
  StillLocked: 'The Garden Club lock has not ended yet.',
  TokenNotSet: 'The token is not connected yet.',
  FeeOnTransfer: 'This token takes a transfer fee, so it cannot be locked.',
  ERC20InsufficientBalance: 'Not enough $MGRD in your wallet.',
};
const cancelled = (e) => e?.code === 4001 || /user rejected|rejected the request|cancel|denied/i.test(e?.shortMessage ?? e?.message ?? '');
function explain(e) {
  if (cancelled(e)) return 'Cancelled in the wallet.';
  const name = e?.walk?.((x) => x?.data?.errorName)?.data?.errorName;
  if (REFUSALS[name]) return REFUSALS[name];
  if (/insufficient funds/i.test(`${e?.details ?? ''} ${e?.message ?? ''}`)) return 'You need a little BNB in your wallet to pay the network fee.';
  return e?.shortMessage ?? e?.message ?? String(e);
}

export function createMgrd({ hud, store, onWardrobe }) {
  let chain = null, lib = null, linked = null;
  const load = async () => {
    chain ??= await api('/api/chain');
    if (chain.enabled && !lib) {
      const [viem, evm] = await Promise.all([import('viem'), import('@mg/shared/chain/evm')]);
      const net = evm.viemChain(chain.cluster, chain.rpc);
      lib = { viem, evm, net, pub: viem.createPublicClient({ chain: net, transport: viem.http(chain.rpc) }) };
    }
    return chain;
  };

  async function connectWallet() {
    const p = provider();
    if (!p) throw new Error('No BNB Chain wallet found. Install MetaMask, Trust Wallet or Binance Wallet, then reload.');
    const accounts = await p.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('The wallet did not share an address.');
    return { p, address: lib.evm.getAddress(accounts[0]) };
  }
  /** Ask the wallet to switch to the game's network, adding it first if the wallet does not know it. */
  async function useNetwork(p) {
    const want = `0x${chain.chainId.toString(16)}`;
    const now = async () => Number(await p.request({ method: 'eth_chainId' }));
    if ((await now()) === chain.chainId) return;
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] }); } catch (e) {
      if (cancelled(e)) throw e;
      const n = lib.net;
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: want, chainName: n.name, nativeCurrency: n.nativeCurrency, rpcUrls: [chain.rpc], ...(chain.explorer ? { blockExplorerUrls: [chain.explorer] } : {}) }] });
    }
    if ((await now()) !== chain.chainId) throw new Error(`Switch your wallet to ${netName(chain)} and try again.`);
  }

  /** Have the player's wallet send one contract call, then wait until it succeeded. Returns the transaction hash. */
  async function sendTx(walletAddress, call) {
    const { p, address } = await connectWallet();
    if (address !== walletAddress) throw new Error(`Switch your wallet to ${shortAddr(walletAddress)} (the linked one) and try again.`);
    await useNetwork(p);
    const { viem, net, pub } = lib;
    try {
      const { request } = await pub.simulateContract({ ...call, account: address }); // a refusal shows before the wallet opens
      const wallet = viem.createWalletClient({ account: address, chain: net, transport: viem.custom(p) });
      const hash = await wallet.writeContract(request);
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== 'success') throw new Error('The transaction failed on chain.');
      return hash;
    } catch (e) { throw new Error(explain(e)); }
  }

  /** Before the contract can take MGRD the wallet must allow it: exactly this amount, never an unlimited one. */
  async function allow(walletAddress, amount) {
    const { evm, pub } = lib;
    const token = { address: chain.token, abi: evm.TOKEN_ABI };
    const [balance, allowed] = await Promise.all([
      pub.readContract({ ...token, functionName: 'balanceOf', args: [walletAddress] }),
      pub.readContract({ ...token, functionName: 'allowance', args: [walletAddress, chain.rewards] }),
    ]);
    if (balance < amount) throw new Error('Not enough $MGRD in your wallet.');
    if (allowed >= amount) return;
    hud.toast(`Step 1 of 2: in your wallet, allow ${mgrd(amount)} $MGRD.`, 'info', 10000);
    await sendTx(walletAddress, evm.approveCall({ token: chain.token, rewards: chain.rewards, amount }));
    hud.toast('Step 2 of 2: now confirm in your wallet.', 'info', 10000);
  }

  async function link() {
    const { p, address } = await connectWallet();
    const { message } = await api('/api/wallet/challenge', {});
    const signature = await p.request({ method: 'personal_sign', params: [lib.viem.toHex(message), address] });
    await api('/api/wallet/link', { address, signature });
    linked = address;
    button();
    hud.toast(`Wallet ${shortAddr(address)} connected and signed!`, 'good');
  }

  /** Show MGRD, with its logo, in the player's wallet (the wallet asks first). */
  async function addToken() {
    await load();
    const { p } = await connectWallet();
    await useNetwork(p);
    const symbol = await lib.pub.readContract({ address: chain.token, abi: lib.evm.TOKEN_ABI, functionName: 'symbol' }); // wallets want the token's own ticker
    await p.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address: chain.token, symbol, decimals: chain.decimals, image: `${location.origin}/token/mgrd.png` } } });
  }

  // ---- top-bar wallet button ------------------------------------------------------------------------
  const btn = document.getElementById('walletBtn');
  function button() {
    if (!btn) return;
    btn.classList.toggle('on', !!linked);
    btn.innerHTML = linked ? `${icon('check')}<b>${esc(shortAddr(linked))}</b>` : `${icon('key')}<b>Connect Wallet</b>`;
    btn.title = linked ? `Linked wallet ${linked}` : 'Connect a BNB Chain wallet and sign to link it';
  }
  /** Read the linked wallet from the server (called after joining). */
  async function sync() {
    try { await load(); } catch { /* chain info optional */ }
    try { linked = (await api('/api/rewards')).wallet; } catch { linked = null; }
    button();
    if (linked && chain?.enabled) api('/api/holder').catch(() => {}); // refresh the badge next to your name
  }
  /** Connect + sign flow; asks which wallet to use when several are installed. */
  async function connectFlow() {
    await load();
    if (!chain.enabled) return open('about');
    const list = installedWallets();
    if (!list.length) {
      return hud.modal(`<h2>${icon('key', 'i big')}Connect Wallet</h2><p>No BNB Chain wallet was found in this browser. Install one, then reload the page. The game uses <b>${esc(netName(chain))}</b>.</p><div class="list">${SUGGESTED.map((x) => `<div class="row">${icon('key')}<div class="meta"><b>${x.name}</b><span>${x.url.replace('https://', '')}</span></div><a class="btn blue" href="${x.url}" target="_blank" rel="noopener">Get ${x.name}</a></div>`).join('')}</div>`);
    }
    const go = async (id) => {
      chosen = id;
      try { localStorage.setItem(PICK_KEY, id); } catch { /* private mode */ }
      hud.modal(null);
      hud.toast('Approve the connection, then sign the message in your wallet (free).', 'info', 8000);
      try { await link(); } catch (e) { hud.toast(explain(e), 'bad', 6000); }
    };
    if (list.length === 1) return go(list[0].id);
    hud.modal(`<h2>${icon('key', 'i big')}Choose a wallet</h2><p class="soft">The game uses <b>${esc(netName(chain))}</b>. Linking only needs a free signature.</p><div class="list">${list.map((x) => `<div class="row">${icon('key')}<div class="meta"><b>${esc(x.name)}</b><span>Installed</span></div><button class="btn gold" data-w="${esc(x.id)}">Connect</button></div>`).join('')}</div>`,
      (el) => el.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => go(b.dataset.w))));
  }
  function menu() {
    hud.modal(`<h2>${icon('key', 'i big')}Your Wallet</h2><div class="row">${icon('check')}<div class="meta"><b>${esc(shortAddr(linked))}</b><span>${esc(linked)}</span></div><button class="btn blue" id="copyW">Copy</button></div>
      <p><button class="btn gold" id="openR">${icon('mgrd')}$MGRD Rewards</button> <button class="btn blue" id="switchW">Switch wallet</button> <button class="btn red" id="discW">Disconnect</button>${chain?.enabled ? ' <button class="btn blue" id="addT">Add MGRD to wallet</button>' : ''}</p>`, (el) => {
      el.querySelector('#addT')?.addEventListener('click', () => addToken().catch((e) => hud.toast(explain(e), 'bad', 5000)));
      el.querySelector('#copyW').addEventListener('click', () => { navigator.clipboard?.writeText(linked); hud.toast('Address copied.', 'good'); });
      el.querySelector('#openR').addEventListener('click', () => open('rewards'));
      el.querySelector('#switchW').addEventListener('click', () => connectFlow());
      el.querySelector('#discW').addEventListener('click', async () => {
        await api('/api/wallet/unlink', {});
        try { await provider()?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }); } catch { /* not every wallet can */ }
        linked = null; button(); hud.modal(null); hud.toast('Wallet disconnected.', 'info');
      });
    });
  }
  btn?.addEventListener('click', () => (linked ? menu() : connectFlow()));
  button();

  async function claim(a) {
    await sendTx(a.wallet, lib.evm.claimCall({ rewards: chain.rewards, epochId: a.epoch, index: a.index, claimant: a.wallet, amount: a.amount, proof: a.proof }));
    hud.toast(`Claimed ${mgrd(a.amount)} $MGRD!`, 'gold', 4000);
  }

  /** Pay for anything with $MGRD: quote -> allow the amount -> payOrder -> the server checks the receipt and grants it. */
  async function pay(kind, id, extra = {}) {
    await load();
    if (!linked) { await connectFlow(); if (!linked) throw new Error('Connect a wallet first.'); }
    const q = await api('/api/mgrd/quote', { kind, id, ...extra });
    await allow(linked, BigInt(q.amount));
    // the contract itself refuses a payment after the quote's deadline, so a late confirmation costs no $MGRD
    await sendTx(linked, lib.evm.payOrderCall({ rewards: q.rewards, orderId: q.orderId, amount: q.amount, deadline: Math.floor(q.expires / 1000) }));
    // the server reads the receipt once a few more blocks are on top of it
    for (let i = 0; i < 20; i++) {
      try {
        const r = await api('/api/shop/confirm', { orderId: q.orderId });
        onWardrobe?.(r.item);
        hud.toast(r.msg || `${q.name}: done!`, 'gold', 4500);
        return r;
      } catch (e) { if (!/not found on chain/.test(e.message) || i === 19) throw e; await new Promise((r) => setTimeout(r, 1500)); }
    }
    return null;
  }
  const buy = (item) => pay('wear', item);

  /** "or 12.3 $MGRD" button for any shop row (empty when the $MGRD shop is closed or the item is not possible now). */
  function priceTag(kind, id) {
    if (!chain?.shop || !store.me) return '';
    const r = mgrdPrice(store.me, kind, id, store.now(), store.seed);
    if (!r.ok) return '';
    const amt = r.mgrd;
    return `<button class="btn mgrdpay" data-mgrd="${kind}:${esc(id)}" title="Pay with $MGRD">${icon('mgrd')}${amt.toLocaleString('en-US', { maximumFractionDigits: 1 })} $MGRD</button>`;
  }
  /** Wire every price tag inside `el`; `after` reopens the panel when done. */
  function bindTags(el, after) {
    el.querySelectorAll('[data-mgrd]').forEach((b) => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const [kind, id] = b.dataset.mgrd.split(':');
      try { hud.toast('Approve the payment in your wallet...', 'info', 8000); await pay(kind, id); } catch (e) { hud.toast(explain(e), 'bad', 7000); }
      after?.();
    }));
  }

  // ---- Garden Club lock ------------------------------------------------------------------------------
  async function clubLock(amountMgrd, days) {
    await load();
    if (!(amountMgrd > 0) || !(amountMgrd < 1e12)) throw new Error('Enter how much $MGRD to lock.');
    const amount = lib.evm.toBase(amountMgrd.toFixed(6));
    await allow(linked, amount);
    await sendTx(linked, lib.evm.clubLockCall({ rewards: chain.rewards, amount, days }));
    hud.toast(`Locked ${amountMgrd.toLocaleString('en-US')} $MGRD. Welcome to the Garden Club!`, 'gold', 5000);
  }
  async function clubUnlock() {
    await load();
    await sendTx(linked, lib.evm.clubUnlockCall({ rewards: chain.rewards }));
    hud.toast('Your $MGRD is back in your wallet.', 'good', 4000);
  }

  const run = (fn, tab) => async () => {
    try { hud.toast('Check your wallet...', 'info', 6000); await fn(); } catch (e) { hud.toast(explain(e), 'bad', 6000); }
    open(tab);
  };

  async function open(tab = 'rewards') {
    hud.modal(`<h2>${icon('mgrd', 'i big')}$MGRD Rewards</h2><p class="soft">Loading...</p>`);
    let c, r, shop;
    try { c = await load(); [r, shop] = await Promise.all([api('/api/rewards'), api('/api/shop')]); linked = r.wallet; button(); } catch (e) { return hud.modal(`<h2>${icon('mgrd', 'i big')}$MGRD Rewards</h2><p>${esc(e.message)}</p>`); }
    const tabs = `<div class="tabsmall">${[['rewards', 'Weekly rewards'], ['shop', '$MGRD shop'], ['club', 'Garden Club'], ['community', 'Community'], ['about', 'How it works']].map(([id, l]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const walletRow = r.wallet
      ? `<div class="row">${icon('key')}<div class="meta"><b>Wallet ${esc(shortAddr(r.wallet))}</b><span>${c.enabled ? esc(netName(c)) : 'Linked'} · rewards are paid to this wallet</span></div><button class="btn red" id="unlink">Unlink</button></div>`
      : `<div class="row">${icon('key')}<div class="meta"><b>No wallet linked</b><span>Link a BNB Chain wallet to receive $MGRD. Signing the link message costs nothing.</span></div><button class="btn gold" id="link" ${c.enabled ? '' : 'disabled'}>Link wallet</button></div>`;
    let body = '';
    if (tab === 'rewards') {
      const items = Object.keys(r.caps).map((k) => ({ label: r.labels[k], have: r.today[k] ?? 0, need: r.caps[k] }));
      const allocs = r.allocations.map((a) => {
        const expired = Date.now() / 1000 > a.deadline;
        const action = a.claimed ? `<span class="worn">${icon('check')}Claimed</span>` : expired ? '<span class="soft">Expired</span>' : `<button class="btn gold" data-claim="${a.epoch}" ${c.enabled ? '' : 'disabled'}>Claim</button>`;
        return `<div class="row ${a.claimed ? 'claimed' : ''}">${icon('mgrd')}<div class="meta"><b>Week of ${esc(a.week)}: ${mgrd(a.amount)} $MGRD</b><span>${a.points} points · to ${esc(shortAddr(a.wallet))}${!a.claimed && !expired ? ` · claim within ${when(a.deadline * 1000 - Date.now())}` : ''}</span></div>${action}</div>`;
      }).join('') || '<p class="soft">No finished weeks yet. Results come every Wednesday for the week before.</p>';
      body = `${walletRow}<h3>This week (${esc(r.week)})</h3><p><b>${r.points}</b> Season Points so far · resets in ${when(r.weekEnds - Date.now())}${r.wallet ? ` · estimate <b>~${short(r.estimate)} $MGRD</b> of the ${short(r.pool)} pool (max 1% each)` : ''}</p>${checklist(items, `Today: ${r.dayTotal} / ${r.dayCap} points`)}<h3>Weeks to claim</h3><div class="list">${allocs}</div>`;
    } else if (tab === 'shop') {
      const owned = new Set(store.me?.wardrobe ?? []);
      body = `${walletRow}<p class="soft">Exclusive cosmetics, only for $MGRD. Cosmetic only: they never change growth, prices or rewards.</p><div class="wear">${shop.items.map((it) => `<div class="wearcard special"><i class="wsw" style="background:${it.color}"></i><b>${esc(it.name)}</b>${owned.has(it.id) ? `<span class="worn">${icon('check')}Owned</span>` : `<button class="btn gold" data-buy="${it.id}" ${shop.enabled && r.wallet ? '' : 'disabled'}>${it.mgrd ? `${icon('mgrd')}${mgrd(it.mgrd)} $MGRD` : 'Soon'}</button>`}</div>`).join('')}</div><h3>Limited drops</h3><p class="soft">Numbered and only sold for $MGRD. When they are gone, they are gone.</p><div class="wear">${shop.limited.map((L) => { const mine = store.me?.editions?.[L.id]; return `<div class="wearcard special"><i class="wsw" style="background:linear-gradient(135deg,#fff3b0,#ffcf40 45%,#c8901a)"></i><b>${esc(L.name)}</b><span class="soft">${L.sold.toLocaleString('en-US')} / ${L.supply.toLocaleString('en-US')} claimed</span>${mine ? `<span class="worn">${icon('check')}Yours: #${mine}</span>` : L.left <= 0 ? '<span class="soft">Sold out</span>' : `<button class="btn gold" data-mgrd="limited:${L.id}" ${shop.enabled ? '' : 'disabled'}>${icon('mgrd')}${L.mgrd ? `${mgrd(L.mgrd)} $MGRD` : 'Soon'}</button>`}</div>`; }).join('')}</div>${shop.enabled ? '' : '<p class="soft">The $MGRD shop opens when the token is live.</p>'}`;
    } else if (tab === 'community') {
      let cm = null;
      try { cm = await api('/api/community'); } catch { cm = null; }
      if (!cm) body = '<p class="soft">Could not load the community page.</p>';
      else {
        const polls = cm.polls.map((pl) => {
          const tot = pl.options.reduce((n, o) => n + o.weight, 0) || 1;
          return `<div class="row"><div class="meta"><b>${esc(pl.question)}</b>${pl.options.map((o, i) => `<div class="pollopt"><span>${esc(o.text)}${pl.myVote === i ? ` ${icon('check')}` : ''}</span><div class="pbar"><i style="width:${Math.round((o.weight / tot) * 100)}%"></i></div><em>${o.voters} vote${o.voters === 1 ? '' : 's'}</em>${pl.open && pl.myVote == null ? `<button class="btn blue" data-vote="${pl.id}:${i}">Vote</button>` : ''}</div>`).join('')}<span>${pl.open ? `Closes in ${when(pl.endsAt - Date.now())} · weight by badge: Sprout 1, Bloom 2, Golden Tree 3` : 'Closed'}</span></div></div>`;
        }).join('') || '<p class="soft">No votes right now. Holders vote on festival themes, new crop looks and the next limited drop.</p>';
        const potPct = Math.min(100, Math.round((Number(cm.pot.total) / Number(cm.pot.goal)) * 100));
        body = `${walletRow}<h3>Holder votes</h3><div class="list">${polls}</div>
          <h3>Fireworks Pot</h3><p>When the village fills the pot (${mgrd(cm.pot.goal)} $MGRD) this week, there are fireworks over the plaza for everyone until Monday. ${cm.pot.reached ? `<b>${icon('check')} Full! Enjoy the show.</b>` : ''}</p><div class="pbar"><i style="width:${potPct}%"></i></div><p class="soft">${mgrd(cm.pot.total)} / ${mgrd(cm.pot.goal)} $MGRD from ${cm.pot.givers} gardener${cm.pot.givers === 1 ? '' : 's'} · half goes to the reward pool, like every $MGRD payment</p>
          <p>${cm.pot.amounts.map((u, i) => `<button class="btn mgrdpay" data-mgrd="pot:${u}" ${c.shop && r.wallet ? '' : 'disabled'}>${icon('mgrd')}${mgrd(cm.pot.mgrd[i])} $MGRD</button>`).join(' ')}</p>
          <h3>Name the fountain</h3><p>${cm.plaque ? `The fountain is <b>"${esc(cm.plaque.text)}"</b>, named by ${esc(cm.plaque.by)} until ${new Date(cm.plaque.until).toLocaleDateString()}.` : 'The fountain has no name yet!'} Your name stays up for ${cm.name.days} days for everyone in every village${cm.name.nextFree > Date.now() + 60_000 ? `; the next free week starts ${new Date(cm.name.nextFree).toLocaleDateString()}` : ''}.</p>
          <p><input id="fname" maxlength="24" placeholder="Fountain name" style="font:700 18px var(--font);padding:6px 10px;border:3px solid var(--bark);border-radius:10px;width:220px"> <button class="btn mgrdpay" id="nameBtn" ${c.shop && r.wallet ? '' : 'disabled'}>${icon('mgrd')}${mgrd(cm.name.mgrd)} $MGRD</button></p>
          <h3>Public burns</h3><p>${(cm.burns.bps / 100).toFixed(0)}% of $MGRD shop revenue is set aside and burned in public. Burned so far: <b>${mgrd(cm.burns.total)} $MGRD</b> · waiting for the next burn: ${mgrd(cm.burns.pending)} $MGRD.</p><div class="list">${cm.burns.list.map((b) => `<div class="row">${icon('mgrd')}<div class="meta"><b>${mgrd(b.amount)} $MGRD burned</b><span>${new Date(b.at).toLocaleDateString()}${b.note ? ` · ${esc(b.note)}` : ''}</span></div>${c.explorer ? `<a class="btn blue" target="_blank" rel="noopener" href="${esc(c.explorer)}/tx/${esc(b.signature)}">View</a>` : ''}</div>`).join('') || '<p class="soft">No burns yet.</p>'}</div>
          <p class="soft">Tips received: ${mgrd(cm.tips.received)} $MGRD (${cm.tips.count}). Tip or gift other gardeners from the Village list.</p>`;
      }
    } else if (tab === 'club') {
      let h = null;
      try { h = r.wallet ? await api('/api/holder') : null; } catch { h = null; }
      const tiers = HOLDER_TIERS.slice().reverse().map((t) => `${tick((h?.balance ?? 0) + (h?.locked ?? 0) >= t.min, `${t.name} (${t.min.toLocaleString('en-US')}+)`)}`).join(' ');
      const club = h?.club;
      body = `${walletRow}<p><b>Holder badge:</b> ${h?.tier ? `<span class="hbadge ${h.tier.id}">${esc(h.tier.name)}</span>` : 'none yet'} · wallet ${(h?.balance ?? 0).toLocaleString('en-US')} $MGRD${h?.locked ? ` + ${h.locked.toLocaleString('en-US')} locked` : ''}</p><p>${tiers}</p>
        <h3>Garden Club</h3><p>Lock at least <b>${(club?.minLock ?? 5000).toLocaleString('en-US')} $MGRD</b> for ${club?.days ?? 30} days. You get the tokens back afterwards (no interest). Members get a club badge, a golden name, the Garden Club Lantern and ${club?.extraDecor ?? 10} more decoration slots.</p>
        ${club?.active ? `<p>${icon('check')} <b>Member</b> until ${new Date(h.unlockAt).toLocaleDateString()}.</p>` : ''}
        ${h?.locked && h.unlockAt <= Date.now() ? `<p><button class="btn gold" id="unlockC">Get my ${h.locked.toLocaleString('en-US')} $MGRD back</button></p>` : ''}
        <p><input id="lockAmt" type="number" min="1" step="1" value="${club?.minLock ?? 5000}" style="font:700 18px var(--font);padding:6px 10px;border:3px solid var(--bark);border-radius:10px;width:140px"> $MGRD for <b>${club?.days ?? 30} days</b> <button class="btn gold" id="lockC" ${c.enabled && r.wallet ? '' : 'disabled'}>${icon('mgrd')}${h?.locked ? 'Add to lock' : 'Join the club'}</button></p>
        <p class="soft">Locked tokens are held by the game's contract on BNB Chain under your wallet; only you can take them out, after the date.</p>`;
    } else {
      body = `<p><b>Season Points</b> come only from activities where everyone has the same chances: the Daily Challenge, villager orders and contracts, festival co-op harvests and Sky Island discoveries. At most 100 points a day. Coins, gems, purchases and garden size never add points; pets help with festival harvests (same daily caps).</p>
        <p><b>Every week</b> the pool is shared by points: your share = pool x your points / everyone's points, at most 1% of the pool per player. Small amounts roll over to the next week. Results are checked for 48 hours, then you can claim for 30 days.</p>
        <p><b>Claiming</b> sends a transaction from your wallet to the reward program, which checks a proof of your fixed amount. Each week can be claimed once.</p>
        <p><b>Fees:</b> claiming, paying and the Garden Club each need a little BNB in your wallet for the network fee. Paying or locking asks twice: first to allow that exact amount, then to confirm. ${tick(c.enabled, c.enabled ? `Live on ${netName(c)}` : 'Not live yet')}</p>
        <p class="soft">$MGRD has no promised price or income. Rewards are funded per week; a week without funding has game prizes only.</p>`;
    }
    hud.modal(`<h2>${icon('mgrd', 'i big')}$MGRD Rewards</h2>${tabs}${body}`, (el) => {
      el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => open(b.dataset.tab)));
      el.querySelector('#link')?.addEventListener('click', () => connectFlow());
      el.querySelector('#unlink')?.addEventListener('click', async () => { await api('/api/wallet/unlink', {}); linked = null; button(); open(tab); });
      el.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', run(() => claim(r.allocations.find((a) => String(a.epoch) === b.dataset.claim)), tab)));
      el.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', run(() => buy(b.dataset.buy), tab)));
      bindTags(el, () => open(tab));
      el.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', async () => { const [poll, option] = b.dataset.vote.split(':').map(Number); try { const v = await api('/api/vote', { poll, option }); hud.toast(`Voted! Your vote counts ${v.weight}x.`, 'good'); } catch (e) { hud.toast(e.message, 'bad', 5000); } open(tab); }));
      el.querySelector('#nameBtn')?.addEventListener('click', run(() => pay('name', el.querySelector('#fname').value), tab));
      el.querySelector('#lockC')?.addEventListener('click', run(() => clubLock(Number(el.querySelector('#lockAmt').value) || 0, 30).then(() => api('/api/holder')), tab));
      el.querySelector('#unlockC')?.addEventListener('click', run(() => clubUnlock().then(() => api('/api/holder')), tab));
    });
  }
  open.sync = sync;
  open.connect = connectFlow;
  open.priceTag = priceTag;
  open.bindTags = bindTags;
  open.pay = pay;

  /** Tip another gardener (wallet to wallet; the server checks the transfer on chain and tells the village). */
  open.tip = async (slot) => {
    try {
      await load();
      if (!linked) { await connectFlow(); if (!linked) return; }
      const rcp = await api('/api/tip/recipient', { slot });
      hud.modal(`<h2>${icon('mgrd', 'i big')}Tip ${esc(rcp.name)}</h2><p>Send $MGRD straight to ${esc(rcp.name)}'s wallet (${esc(shortAddr(rcp.wallet))}).</p><p>${rcp.amounts.map((a) => `<button class="btn mgrdpay" data-tip="${a}">${icon('mgrd')}${a} $MGRD</button>`).join(' ')}</p>`, (el) => el.querySelectorAll('[data-tip]').forEach((b) => b.addEventListener('click', async () => {
        try {
          hud.toast('Approve the tip in your wallet...', 'info', 8000);
          const amount = lib.evm.toBase(b.dataset.tip);
          const sig = await sendTx(linked, lib.evm.transferCall({ token: chain.token, to: rcp.wallet, amount }));
          const res = await api('/api/tip/confirm', { signature: sig, slot });
          hud.modal(null);
          hud.toast(`You tipped ${esc(rcp.name)} ${res.amount ?? b.dataset.tip} $MGRD!`, 'gold', 4000);
        } catch (e) { hud.toast(explain(e), 'bad', 6000); }
      })));
    } catch (e) { hud.toast(e.message ?? String(e), 'bad', 5000); }
  };
  /** Gift an outfit to another gardener (paid with $MGRD, granted to them). */
  open.gift = async (slot, name) => {
    await load();
    if (!chain?.shop) return hud.toast('Gifts open when the $MGRD shop is live.', 'info');
    const items = (await api('/api/shop')).items;
    hud.modal(`<h2>${icon('gift', 'i big')}Gift ${esc(name)}</h2><p class="soft">Pick an outfit. ${esc(name)} gets it straight away.</p><div class="wear">${items.map((it) => `<div class="wearcard special"><i class="wsw" style="background:${it.color}"></i><b>${esc(it.name)}</b><button class="btn mgrdpay" data-g="${it.id}">${icon('mgrd')}${it.mgrd ? `${mgrd(it.mgrd)} $MGRD` : 'Soon'}</button></div>`).join('')}</div>`, (el) => el.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', async () => {
      try { hud.toast('Approve the payment in your wallet...', 'info', 8000); await pay('gift', b.dataset.g, { to: slot }); hud.modal(null); } catch (e) { hud.toast(explain(e), 'bad', 6000); }
    })));
  };
  return open;
}
