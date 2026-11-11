// Login / add-account form. Params: { new: true } for a blank form, { accountId } to edit one;
// otherwise edits the current account (or starts a blank one on first run).
import * as store from '../store.js';
import * as api from '../api.js';
import { router } from '../router.js';
import * as nav from '../nav.js';

const FIELDS = [
  ['server', 'Server or M3U link', 'text'],
  ['user', 'Username', 'text'],
  ['pass', 'Password', 'password'],
  ['ua', 'User agent (optional)', 'text'],
];

export function loginView() {
  let root; let form; let errorEl; let busy = false; let onActivate;

  const input = (n) => form.elements[n];

  function setError(msg) { errorEl.textContent = msg; }

  function pickAccount(params) {
    if (params && params.new) return store.newAccount();
    const list = store.accounts();
    if (params && params.accountId !== undefined) {
      const hit = list.find((a) => a.id === params.accountId);
      if (hit) return hit;
    }
    return store.current() || store.newAccount();
  }

  // A pasted get.php link in the server box is split into server/user/pass.
  function onServerInput() {
    const v = input('server').value;
    if (!/[?]/.test(v)) return;
    const p = api.parseLink(v);
    input('server').value = p.server;
    if (p.user) input('user').value = p.user;
    if (p.pass) input('pass').value = p.pass;
  }

  async function submit(acc) {
    if (busy) return;
    const server = input('server').value.trim();
    const user = input('user').value.trim();
    const pass = input('pass').value;
    if (!server || !user || !pass) { setError('Enter server, username and password.'); return; }
    busy = true;
    setError('');
    const prevAcc = store.accounts().find((a) => a.id === acc.id) || null;
    const prevCurrent = store.current()?.id;
    // Save + select first: api.login reads its credentials from the current account.
    store.saveAccount({ ...acc, server, user, pass, ua: input('ua').value.trim(), ok: false });
    store.setCurrent(acc.id);
    try {
      const info = await api.login();
      if (!info || !info.user_info || typeof info.user_info !== 'object') {
        throw new Error("This doesn't look like an Xtream server");
      }
      store.saveAccount({ ...store.current(), ok: true });
      busy = false;
      router.go('home', { status: api.describeAccount(info) });
    } catch (err) {
      busy = false;
      // Roll back so a failed attempt never leaves a half-saved account or changes the selection.
      if (prevAcc) store.saveAccount(prevAcc); else store.removeAccount(acc.id);
      if (prevCurrent !== undefined && store.accounts().some((a) => a.id === prevCurrent)) store.setCurrent(prevCurrent);
      setError(`Login failed: ${err && err.message ? err.message : err}`);
    }
  }

  return {
    mount(rootEl, params) {
      root = rootEl;
      const acc = pickAccount(params);
      const el = document.createElement('div');
      el.className = 'login';
      el.innerHTML = '<h1>YM Player</h1><form novalidate></form><p class="error" role="alert"></p>';
      form = el.querySelector('form');
      errorEl = el.querySelector('.error');
      for (const [name, text, type] of FIELDS) {
        const lab = document.createElement('label');
        lab.textContent = text;
        const i = document.createElement('input');
        i.name = name; i.type = type; i.autocomplete = 'off'; i.value = acc[name] || '';
        lab.appendChild(i);
        form.appendChild(lab);
      }
      const row = document.createElement('div');
      row.className = 'actions';
      row.innerHTML = '<button type="submit" class="primary">Log in</button>';
      if (store.accounts().length > 0) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.action = 'accounts'; b.textContent = 'Accounts';
        row.appendChild(b);
      }
      form.appendChild(row);
      root.appendChild(el);

      input('server').addEventListener('input', onServerInput);
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(acc); });
      // D-pad Enter reaches buttons as an 'activate' event (see nav.js); text fields submit natively.
      onActivate = (e) => { if (e.target.tagName === 'BUTTON') e.target.click(); };
      root.addEventListener('activate', onActivate);
      row.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'accounts') router.go('setup');
      });

      nav.register(root);
      input('server').focus();
    },
    unmount() {
      if (root && onActivate) root.removeEventListener('activate', onActivate);
      root = form = errorEl = onActivate = null;
    },
  };
}
