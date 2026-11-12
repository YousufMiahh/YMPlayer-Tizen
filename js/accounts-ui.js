// Settings -> ACCOUNTS rows (SettingsActivity.build, switchTo, confirmRemove). Phase 8 restyles
// Settings; the behaviour here is already Android's:
//   {label}             "✓  In use" (current, not actionable) / "Switch" -> restart at Home
//   Add Account         -> Login (add)
//   Edit This Account   -> Login (edit the current account)
//   Remove This Account -> "Remove {label}?" dialog -> delete its library and data, restart Home
import * as store from './store.js';
import * as repo from './repo.js';
import { router } from './router.js';
import { dialog } from './ui/dialog.js';

/** Prefs.Account.label(): the name, or "user @ host" (server without the scheme). */
export function label(acc) {
  if (acc.name && acc.name.trim()) return acc.name.trim();
  return `${acc.user} @ ${String(acc.server || '').replace(/^https?:\/\//, '')}`;
}

/** SettingsActivity.restartHome: clear the stack and start at Home (or Login with no account). */
export function restartHome() {
  router.resetTo(store.hasAccount() ? 'home' : 'login');
}

/** SettingsActivity.switchTo. */
export function switchTo(id) {
  store.setCurrent(id);
  repo.clear();
  restartHome();
}

/** SettingsActivity.confirmRemove. Resolves true if the account was removed. */
export async function confirmRemove(acc) {
  const r = await dialog({
    title: `Remove ${label(acc)}?`,
    message: 'Its favourites and watch history will be deleted from this device.',
    positive: 'Remove',
    negative: 'Cancel',
  });
  if (r !== 'positive') return false;
  await repo.deleteFiles(acc.server, acc.user);
  store.removeAccount(acc.id);
  repo.clear();
  restartHome();
  return true;
}

function row(text, value, attrs) {
  const r = document.createElement('div');
  r.className = 'setting';
  const l = document.createElement('span');
  l.textContent = text;
  r.appendChild(l);
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = value;
  for (const [k, v] of Object.entries(attrs)) b.dataset[k] = v;
  r.appendChild(b);
  return r;
}

/** Builds the ACCOUNTS rows into `host`. Returns { dispose }. */
export function mountAccounts(host) {
  const cur = store.current();
  for (const a of store.accounts()) {
    const isCur = !!cur && cur.id === a.id;
    const r = row(label(a), isCur ? '✓  In use' : 'Switch', { action: isCur ? 'in-use' : 'switch' });
    r.dataset.account = a.id;
    if (isCur) r.querySelector('button').setAttribute('aria-disabled', 'true'); // info row: not focusable
    host.appendChild(r);
  }
  host.appendChild(row('Add Account', '', { action: 'add' }));
  host.appendChild(row('Edit This Account', '', { action: 'edit' }));
  if (cur) host.appendChild(row('Remove This Account', '', { action: 'remove' }));

  function onClick(e) {
    const b = e.target.closest && e.target.closest('[data-action]');
    if (!b || !host.contains(b)) return;
    const action = b.dataset.action;
    if (action === 'switch') switchTo(b.closest('[data-account]').dataset.account);
    else if (action === 'add') router.go('login', { add: true });
    else if (action === 'edit') router.go('login', { edit: true });
    else if (action === 'remove') { const c = store.current(); if (c) confirmRemove(c); }
  }
  host.addEventListener('click', onClick);
  return { dispose() { host.removeEventListener('click', onClick); } };
}
