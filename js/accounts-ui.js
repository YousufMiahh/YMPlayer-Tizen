// Settings -> ACCOUNTS rows (SettingsActivity.build, switchTo, confirmRemove):
//   {label}             "✓  In use" (current, an info row) / "Switch" -> restart at Home
//   Subscription        "Checking…" -> the account's status (an info row)
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

/**
 * Builds the ACCOUNTS rows into `host` with SettingsActivity's row builder
 * `makeRow(label, value, action | null, key)`. Returns { statusValue, dispose }: statusValue is
 * the Subscription row's value element ("Checking…" until the caller fills it in).
 */
export function mountAccounts(host, makeRow) {
  const cur = store.current();
  const add = (label_, value, action, key) => { const r = makeRow(label_, value, action, key); host.appendChild(r); return r; };
  for (const a of store.accounts()) {
    const isCur = !!cur && cur.id === a.id;
    const r = add(label(a), isCur ? '✓  In use' : 'Switch', isCur ? null : () => switchTo(a.id), `account_${a.id}`);
    r.dataset.account = a.id;
  }
  const status = add('Subscription', 'Checking…', null, 'subscription');
  add('Add Account', '', () => router.go('login', { add: true }), 'add_account');
  add('Edit This Account', '', () => router.go('login', { edit: true }), 'edit_account');
  if (cur) add('Remove This Account', '', () => { const c = store.current(); if (c) confirmRemove(c); }, 'remove_account');
  return { statusValue: status.querySelector('.srow-value'), dispose() {} };
}
