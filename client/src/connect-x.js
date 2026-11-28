// "Connect X" screen: sign in with X, and if the account is a Mihao admin, wear or download the admin cat.
// The server decides everything (server/src/x.js); this only shows it. Nothing appears while it is off.
import { icon, esc } from './ui/hud.js';

const RESULTS = {
  connected: ['Your X account is connected.', 'good'],
  cancelled: ['The X sign-in was cancelled.', 'info'],
  expired: ['That sign-in ran out of time or was started somewhere else. Try again.', 'bad'],
  failed: ['X could not confirm your account. Try again.', 'bad'],
};

export function createConnectX({ hud }) {
  let status = { enabled: false };

  async function call(path, body) {
    const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    return data;
  }
  const refresh = async () => { status = await call('/api/x/status'); return status; };
  const act = async (path, body) => {
    try { await call(path, body); await refresh(); open(); } catch (e) { hud.toast(e.message, 'bad'); }
  };

  function body() {
    const test = status.mock ? '<p class="xtest"><b>TEST MODE.</b> This is not the real X sign-in. It works only on this computer.</p>' : '';
    if (!status.linked) {
      return `${test}<p>Are you a <b>Mihao admin</b>? Connect your X account to unlock your admin cat.</p><p class="soft">The game reads only your username and account number. It never posts for you and does not keep your X sign-in.</p><p><button class="btn gold" id="xGo">${icon('chat')}Connect X</button></p>`;
    }
    const who = `<p>Connected as <b>@${esc(status.linked.username)}</b>.</p>`;
    const leave = '<p><button class="btn blue" id="xOff">Disconnect X</button></p>';
    if (status.taken) return `${test}${who}<p>This admin name was already claimed by a different X account. Please contact the team.</p>${leave}`;
    if (!status.listed) return `${test}${who}<p>This account is not on the admin gift list.</p>${leave}`;
    if (!status.gift) return `${test}${who}<p>You are on the admin list. Your cat has not been chosen yet: please check back soon.</p>${leave}`;
    const g = status.gift;
    return `${test}${who}<div class="xgift"><img src="/models/admins/${esc(g.id)}.webp" alt="${esc(g.name)}" width="200" height="200"><div><h3>Your gift: ${esc(g.name)}</h3><p><button class="btn ${status.wearing ? 'red' : 'gold'}" id="xWear">${icon('user')}${status.wearing ? 'Take it off' : 'Wear it in the garden'}</button></p>${g.download ? '<p><a class="btn blue" href="/api/x/gift" download>Download my gift (.zip)</a></p>' : '<p class="soft">The download is not on this server yet.</p>'}${status.wearing ? '<p class="soft">Close this window to see your cat. Wardrobe changes show again after you take it off.</p>' : ''}</div></div>${leave}`;
  }

  function open() {
    hud.modal(`<h2>${icon('gift', 'i big')}Admin Gift</h2>${body()}`, (card) => {
      card.querySelector('#xGo')?.addEventListener('click', async () => {
        try { location.assign((await call('/api/x/start', {})).url); } catch (e) { hud.toast(e.message, 'bad'); }
      });
      card.querySelector('#xWear')?.addEventListener('click', () => act('/api/x/wear', { on: !status.wearing }));
      card.querySelector('#xOff')?.addEventListener('click', () => act('/api/x/disconnect', {}));
    });
  }

  return {
    open,
    menuItems: () => (status.enabled ? [['gift', 'Connect X', () => refresh().then(open, (e) => hud.toast(e.message, 'bad'))]] : []),
    /** Ask whether the feature is on, show its button, and finish a sign-in we have just come back from. */
    async start() {
      const here = new URL(location.href);
      const result = here.searchParams.get('x');
      if (result !== null) { here.searchParams.delete('x'); history.replaceState(null, '', here); }
      try { await refresh(); } catch { return; }
      if (!status.enabled) return;
      const button = document.getElementById('xConnect');
      if (button) { button.hidden = false; button.addEventListener('click', () => refresh().then(open, (e) => hud.toast(e.message, 'bad'))); }
      if (result !== null && Object.hasOwn(RESULTS, result)) {
        hud.toast(...RESULTS[result]);
        open();
      }
    },
  };
}
