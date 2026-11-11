// Saved-accounts manager: list, switch, remove, add.
import * as store from '../store.js';
import { router } from '../router.js';
import * as nav from '../nav.js';
import { clearCache } from '../home-rows.js';

export function label(acc) {
  if (acc.name) return acc.name;
  let host = acc.server;
  try { host = new URL(/^https?:\/\//i.test(acc.server) ? acc.server : `http://${acc.server}`).host; } catch { /* keep raw */ }
  return `${acc.user}@${host}`;
}

/**
 * Account list + Add button, shared by the Setup and Settings views.
 * Builds into `host`; `root` is the nav container to refocus. Returns { dispose }.
 */
export function mountAccounts(host, root) {
  host.innerHTML = '<div class="accounts"></div><div class="actions"><button type="button" data-action="add" class="primary">Add account</button></div>';
  const list = host.querySelector('.accounts');

  function render() {
    list.replaceChildren();
    const cur = store.current();
    for (const a of store.accounts()) {
      const row = document.createElement('div');
      row.className = 'account';
      row.dataset.account = a.id;
      const name = document.createElement('span');
      name.textContent = label(a) + (cur && cur.id === a.id ? ' (current)' : '');
      row.appendChild(name);
      for (const [action, text] of [['switch', 'Use'], ['remove', 'Remove']]) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.action = action; b.textContent = text;
        row.appendChild(b);
      }
      list.appendChild(row);
    }
  }

  function onClick(e) {
    const action = e.target.dataset && e.target.dataset.action;
    if (action !== 'add' && action !== 'switch' && action !== 'remove') return;
    const row = e.target.closest('[data-account]');
    if (action === 'add') { router.go('login', { new: true }); return; }
    if (action === 'switch') {
      store.setCurrent(row.dataset.account);
      clearCache(); // Home caches Recently Added per type, not per account
      render(); nav.focusFirst(root); return;
    }
    store.removeAccount(row.dataset.account);
    if (store.accounts().length === 0) { router.go('login', { new: true }); return; }
    clearCache(); // the current account may have changed
    render();
    nav.focusFirst(root);
  }

  render();
  host.addEventListener('click', onClick);
  return { dispose() { host.removeEventListener('click', onClick); } };
}

export function setupView() {
  let root; let accountsUi; let onActivate;

  return {
    mount(rootEl) {
      root = rootEl;
      const el = document.createElement('div');
      el.className = 'login setup';
      el.innerHTML = '<h1>Accounts</h1><div class="accounts-host"></div>';
      root.appendChild(el);
      accountsUi = mountAccounts(el.querySelector('.accounts-host'), root);
      onActivate = (e) => { if (e.target.tagName === 'BUTTON') e.target.click(); };
      root.addEventListener('activate', onActivate);
      nav.register(root);
      nav.focusFirst(root);
    },
    unmount() {
      if (root && onActivate) root.removeEventListener('activate', onActivate);
      if (accountsUi) accountsUi.dispose();
      root = accountsUi = onActivate = null;
    },
  };
}
