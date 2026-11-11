// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', async (orig) => ({ ...(await orig()), login: vi.fn() }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import { router } from '../js/router.js';
import { loginView } from '../js/views/login.js';
import { setupView, label } from '../js/views/setup.js';

const GOOD = { user_info: { status: 'Active', exp_date: '1893456000', active_cons: '1', max_connections: '2' } };
let root;

function fill(sel, v) {
  const el = root.querySelector(sel);
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const submit = () => root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
  router.init(root);
  router.register('login', loginView);
  router.register('setup', setupView);
  router.register('home', () => ({ mount(r) { r.innerHTML = '<p id="home"></p>'; }, unmount() {} }));
  api.login.mockReset();
});
afterEach(() => router.reset());

describe('login view', () => {
  it('saves + selects the account BEFORE calling login, then marks ok and goes home', async () => {
    let seen;
    api.login.mockImplementation(async () => { seen = { ...store.current() }; return GOOD; });
    router.go('login');
    fill('[name=server]', 'host.tv:8080');
    fill('[name=user]', 'bob');
    fill('[name=pass]', 'secret');
    submit();
    await tick();
    expect(api.login).toHaveBeenCalledTimes(1);
    expect(seen).toMatchObject({ server: 'host.tv:8080', user: 'bob', pass: 'secret', ok: false });
    expect(store.current()).toMatchObject({ user: 'bob', ok: true });
    expect(store.hasAccount()).toBe(true);
    expect(router.current().name).toBe('home');
  });

  it('shows the account status line after a successful login (before leaving)', async () => {
    api.login.mockResolvedValue(GOOD);
    router.go('login');
    fill('[name=server]', 'h'); fill('[name=user]', 'u'); fill('[name=pass]', 'p');
    submit();
    await tick();
    // status is surfaced via the home params so a later view can show it
    expect(router.current().params.status).toBe(api.describeAccount(GOOD));
    expect(router.current().params.status).toContain('Connections: 1/2');
  });

  it('splits a pasted get.php M3U link into server/user/pass', async () => {
    api.login.mockResolvedValue(GOOD);
    router.go('login');
    fill('[name=server]', 'http://host.tv:8080/get.php?username=amy&password=pw1&type=m3u_plus');
    expect(root.querySelector('[name=server]').value).toBe('http://host.tv:8080');
    expect(root.querySelector('[name=user]').value).toBe('amy');
    expect(root.querySelector('[name=pass]').value).toBe('pw1');
    submit();
    await tick();
    expect(store.current()).toMatchObject({ server: 'http://host.tv:8080', user: 'amy', pass: 'pw1', ok: true });
  });

  it('failed login shows an error, stays on login, and leaves no account behind', async () => {
    api.login.mockRejectedValue(new Error('Server returned HTTP 401'));
    router.go('login');
    fill('[name=server]', 'h'); fill('[name=user]', 'u'); fill('[name=pass]', 'p');
    submit();
    await tick();
    expect(root.querySelector('.error').textContent).toContain('HTTP 401');
    expect(router.current().name).toBe('login');
    expect(store.accounts()).toEqual([]);
    expect(store.hasAccount()).toBe(false);
  });

  it('login response without user_info is a failure', async () => {
    api.login.mockResolvedValue({ server_info: {} });
    router.go('login');
    fill('[name=server]', 'h'); fill('[name=user]', 'u'); fill('[name=pass]', 'p');
    submit();
    await tick();
    expect(root.querySelector('.error').textContent).not.toBe('');
    expect(store.hasAccount()).toBe(false);
  });

  it('failed re-login of an existing account restores it and the current selection', async () => {
    const a = store.newAccount(); Object.assign(a, { server: 'old', user: 'o', pass: 'o', ok: true });
    store.saveAccount(a); store.setCurrent(a.id);
    api.login.mockRejectedValue(new Error('nope'));
    router.go('login');
    fill('[name=pass]', 'changed');
    submit();
    await tick();
    expect(store.current()).toMatchObject({ pass: 'o', ok: true });
  });

  it('empty required fields do not call login', async () => {
    router.go('login');
    fill('[name=server]', 'h');
    submit();
    await tick();
    expect(api.login).not.toHaveBeenCalled();
    expect(root.querySelector('.error').textContent).not.toBe('');
  });

  it('persists the optional user agent', async () => {
    api.login.mockResolvedValue(GOOD);
    router.go('login');
    fill('[name=server]', 'h'); fill('[name=user]', 'u'); fill('[name=pass]', 'p'); fill('[name=ua]', 'MyUA/1');
    submit();
    await tick();
    expect(store.userAgent()).toBe('MyUA/1');
  });

  it('inputs are focusable and focus lands on the first field', () => {
    router.go('login');
    expect(document.activeElement).toBe(root.querySelector('[name=server]'));
  });
});

describe('setup view (multi-account)', () => {
  function seed() {
    const a = store.newAccount(); Object.assign(a, { server: 'http://a.tv', user: 'ann', pass: 'x', ok: true });
    store.saveAccount(a);
    const b = store.newAccount(); Object.assign(b, { server: 'http://b.tv', user: 'ben', pass: 'y', ok: true, name: 'Ben TV' });
    store.saveAccount(b);
    store.setCurrent(a.id);
    return [a, b];
  }

  it('lists accounts using label()', () => {
    const [a, b] = seed();
    router.go('setup');
    const rows = [...root.querySelectorAll('[data-account]')].map((r) => r.textContent);
    expect(rows.join('|')).toContain(label(a));
    expect(rows.join('|')).toContain('Ben TV');
    expect(label(a)).toBe('ann@a.tv');
  });

  it('switch sets current', () => {
    const [, b] = seed();
    router.go('setup');
    root.querySelector(`[data-account="${b.id}"] [data-action=switch]`).click();
    expect(store.current().id).toBe(b.id);
  });

  it('remove deletes the account and re-selects another', () => {
    const [a, b] = seed();
    router.go('setup');
    root.querySelector(`[data-account="${a.id}"] [data-action=remove]`).click();
    expect(store.accounts().map((x) => x.id)).toEqual([b.id]);
    expect(store.current().id).toBe(b.id);
    expect(root.querySelectorAll('[data-account]').length).toBe(1);
  });

  it('add opens a blank login form and a successful login adds a second account and selects it', async () => {
    seed();
    api.login.mockResolvedValue(GOOD);
    router.go('setup');
    root.querySelector('[data-action=add]').click();
    expect(router.current().name).toBe('login');
    expect(root.querySelector('[name=server]').value).toBe('');
    fill('[name=server]', 'http://c.tv'); fill('[name=user]', 'cat'); fill('[name=pass]', 'z');
    submit();
    await tick();
    expect(store.accounts().length).toBe(3);
    expect(store.current().user).toBe('cat');
  });

  it('failed add keeps the previous current account', async () => {
    const [a] = seed();
    api.login.mockRejectedValue(new Error('bad'));
    router.go('setup');
    root.querySelector('[data-action=add]').click();
    fill('[name=server]', 'c'); fill('[name=user]', 'u'); fill('[name=pass]', 'p');
    submit();
    await tick();
    expect(store.accounts().length).toBe(2);
    expect(store.current().id).toBe(a.id);
  });
});
