// Port of LoginActivity.java: the sign-in form card and the "Use your phone" card side by side.
// Params: { add: true } adds a new account ("Add Account"); { edit: true } (Android's "switch"
// extra) or no params edits the current account, or signs in for the first time.
// On success the account is saved and made current, and the Setup download screen takes over.
import * as store from '../store.js';
import * as api from '../api.js';
import * as repo from '../repo.js';
import { router } from '../router.js';
import * as nav from '../nav.js';
import * as backdrop from '../ui/backdrop.js';
import { pillButton, pillInput } from '../ui/widgets.js';

export const ERROR_COLOR = '#FF7A7A';
export const SUBTITLE = 'Sign in with the details from your TV provider. '
  + 'You can also paste a full get.php / M3U link into the server box.';
export const PHONE_TEXT = "Typing your details on your phone isn't available on this TV yet. "
  + 'Please use the form on the left.';
export const PHONE_BOX_TEXT = 'Not available on this TV yet';

/** LoginActivity.candidateBases: as typed, without any extra path, then http/https swapped. */
export function candidateBases(typed) {
  const out = [typed];
  let hostOnly = typed;
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(typed);
  if (m) hostOnly = `${m[1]}://${m[2]}`;
  const swap = (s) => {
    if (s.startsWith('https://')) return `http://${s.slice(8)}`;
    if (s.startsWith('http://')) return `https://${s.slice(7)}`;
    return s;
  };
  for (const s of [hostOnly, swap(typed), swap(hostOnly)]) if (!out.includes(s)) out.push(s);
  return out;
}

/**
 * LoginActivity.tryAll. Android also retries each address with several app names
 * (IPTVSmartersPlayer, okhttp, VLC, …), but a web app cannot set the User-Agent header, so every
 * address is tried once.
 * @returns {{response, base, error, lastUrl}}
 */
export async function tryAll(typed, u, p) {
  const o = { response: null, base: null, error: null, lastUrl: '' };
  for (const base of candidateBases(typed)) {
    o.lastUrl = `${base}/player_api.php`;
    try {
      const r = await api.loginAt(base, u, p);
      if (r && r.user_info && typeof r.user_info === 'object') {
        o.response = r; o.base = base; o.error = null;
        return o;
      }
      o.error = new Error('Server answered, but not like an Xtream server');
    } catch (e) {
      o.error = e;
    }
  }
  return o;
}

/** Fills empty user/password fields from a pasted get.php / M3U link (on submit, like Android). */
export function fromLink(s, u, p) {
  if (!(s.includes('username=') && s.includes('password='))) return { u, p };
  const q = s.indexOf('?');
  const params = new URLSearchParams(q >= 0 ? s.slice(q + 1) : '');
  return { u: u || params.get('username') || '', p: p || params.get('password') || '' };
}

export function loginView() {
  let root = null; let adding = false; let busy = false;
  let fields = {}; let status; let loginBtn; let onActivate; let onClick;

  function setStatus(text, color) {
    status.textContent = text;
    status.style.color = color || '';
  }

  async function attempt() {
    if (busy) return;
    const s = fields.server.value.trim();
    let u = fields.user.value.trim();
    let p = fields.pass.value.trim();
    ({ u, p } = fromLink(s, u, p));
    fields.user.value = u;
    fields.pass.value = p;
    const typed = api.normalize(s);
    if (!typed || !u || !p) {
      setStatus('Please fill in the server, username and password.', ERROR_COLOR);
      return;
    }
    const name = fields.name.value.trim();
    setStatus('Connecting…', 'var(--text2)');
    // login.setEnabled(false). Not the `disabled` attribute: that would drop focus off the button.
    busy = true;
    loginBtn.dataset.busy = 'true';
    let o;
    try { o = await tryAll(typed, u, p); } finally {
      busy = false;
      if (loginBtn) delete loginBtn.dataset.busy;
    }
    if (!root) return; // left the screen meanwhile
    const ui = o.response && o.response.user_info;
    if (!ui) {
      setStatus(`Couldn't log in: ${api.errorMessage(o.error)}\nLast address tried: ${o.lastUrl}`
        + '\nCheck the server address with your provider — it should be just http://host:port', ERROR_COLOR);
      return;
    }
    if (Number(ui.auth ?? 0) !== 1) {
      const st = ui.status !== undefined && ui.status !== null ? ` (account status: ${ui.status})` : '';
      setStatus(`The server rejected the login — check your username and password${st}.`, ERROR_COLOR);
      return;
    }
    const cur = store.current();
    const acc = adding || !cur ? store.newAccount() : { ...cur };
    acc.name = name;
    acc.server = o.base;
    acc.user = u;
    acc.pass = p;
    if (adding) acc.ua = '';
    acc.ok = true;
    store.saveAccount(acc);
    store.setCurrent(acc.id);
    repo.clear();
    router.resetTo('setup'); // download everything once, with progress, before showing Home
  }

  function phonePanel() {
    const p = document.createElement('div');
    p.className = 'login-card login-phone';
    p.innerHTML = '<div class="login-phone-title">Use your phone</div><div class="login-phone-text"></div>'
      + '<div class="login-qr-box"><div class="login-qr-off"></div></div>'
      + '<div class="login-qr-url"></div><div class="login-phone-status"></div>';
    p.querySelector('.login-phone-text').textContent = PHONE_TEXT;
    p.querySelector('.login-qr-off').textContent = PHONE_BOX_TEXT;
    return p;
  }

  return {
    mount(rootEl, params = {}) {
      root = rootEl;
      adding = !!(params && params.add);
      backdrop.setSection('home'); // Ambient.install(this, Ambient.HOME)

      const pair = document.createElement('div');
      pair.className = 'login';
      const col = document.createElement('div');
      col.className = 'login-card login-form';
      const title = document.createElement('div');
      title.className = 'login-title';
      title.textContent = adding ? 'Add Account' : 'YM Player';
      const sub = document.createElement('div');
      sub.className = 'login-sub';
      sub.textContent = SUBTITLE;
      col.append(title, sub);

      fields = {
        name: pillInput('Account name (optional, e.g. Home or Sports)'),
        server: pillInput('Server URL  (e.g. http://example.com:8080)', 'url'),
        user: pillInput('Username'),
        pass: pillInput('Password'), // TYPE_TEXT_VARIATION_VISIBLE_PASSWORD: not masked
      };
      const cur = store.current();
      if (!adding && cur) {
        fields.name.value = cur.name || '';
        fields.server.value = cur.server || '';
        fields.user.value = cur.user || '';
        fields.pass.value = cur.pass || '';
      }
      for (const [k, i] of Object.entries(fields)) {
        i.name = k;
        i.spellcheck = false;
        i.setAttribute('autocapitalize', k === 'name' ? 'words' : 'off');
        col.appendChild(i);
      }

      loginBtn = pillButton(adding ? 'Add Account' : 'Log in', { action: 'login' });
      loginBtn.classList.add('login-button');
      status = document.createElement('div');
      status.className = 'login-status';
      status.setAttribute('role', 'status');
      col.append(loginBtn, status);
      pair.append(col, phonePanel());
      root.appendChild(pair);

      onClick = (e) => { if (e.target.closest && e.target.closest('[data-action="login"]')) attempt(); };
      onActivate = (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.click(); };
      pair.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      nav.register(root);
      (adding ? fields.name : fields.server).focus();
    },
    unmount() {
      if (root) {
        root.removeEventListener('activate', onActivate);
        const pair = root.querySelector('.login');
        if (pair) pair.removeEventListener('click', onClick);
      }
      root = status = loginBtn = null;
      fields = {};
    },
  };
}
