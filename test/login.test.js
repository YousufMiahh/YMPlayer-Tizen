// @vitest-environment jsdom
// Login (LoginActivity.java): layout, modes, validation, candidate addresses, errors, routing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', async (orig) => ({ ...(await orig()), loginAt: vi.fn() }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as repo from '../js/repo.js';
import { router } from '../js/router.js';
import { loginView, candidateBases, fromLink, SUBTITLE, ERROR_COLOR } from '../js/views/login.js';

const GOOD = { user_info: { auth: 1, status: 'Active' } };
let root;
const $ = (s) => root.querySelector(s);
const field = (n) => $(`[name=${n}]`);
function fill(n, v) { field(n).value = v; field(n).dispatchEvent(new Event('input', { bubbles: true })); }
const submit = () => $('[data-action=login]').click();
const tick = () => new Promise((r) => setTimeout(r, 0));
const stub = (name) => () => ({ mount(r) { r.innerHTML = `<p id="${name}"></p>`; }, unmount() {} });
const status = () => $('.login-status');

function seedAccount(extra = {}) {
  const a = { ...store.newAccount(), name: 'Home', server: 'http://old.tv', user: 'olga', pass: 'pw', ok: true, ...extra };
  store.saveAccount(a); store.setCurrent(a.id);
  return a;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
  router.init(root);
  router.register('login', loginView);
  router.register('setup', stub('setup'));
  router.register('home', stub('home'));
  router.register('settings', stub('settings'));
  api.loginAt.mockReset();
});
afterEach(() => router.reset());

describe('login layout (LoginActivity.java:62-119)', () => {
  it('two cards: the form and "Use your phone"', () => {
    router.go('login');
    const cards = [...root.querySelectorAll('.login > .login-card')];
    expect(cards.map((c) => c.classList.contains('login-form') ? 'form' : 'phone')).toEqual(['form', 'phone']);
    expect($('.login-title').textContent).toBe('YM Player');
    expect($('.login-sub').textContent).toBe(SUBTITLE);
    expect($('.login-phone-title').textContent).toBe('Use your phone');
  });

  it('has the four Android fields in order, a visible password and no user-agent field', () => {
    router.go('login');
    const inputs = [...root.querySelectorAll('.login-form input')];
    expect(inputs.map((i) => i.placeholder)).toEqual([
      'Account name (optional, e.g. Home or Sports)',
      'Server URL  (e.g. http://example.com:8080)',
      'Username',
      'Password',
    ]);
    expect(field('pass').type).not.toBe('password');
    expect(field('ua')).toBeNull();
    expect($('[data-action=login]').textContent).toBe('Log in');
    expect($('[data-action=accounts]')).toBeNull();
  });

  it('the phone panel says honestly that it is not available, with no QR code', () => {
    router.go('login');
    expect($('.login-phone svg, .login-phone img')).toBeNull();
    expect($('.login-qr-off').textContent).toBe('Not available on this TV yet');
    expect($('.login-phone-text').textContent).toMatch(/isn't available on this TV yet/);
  });

  it('first run focuses the server field; the form is empty', () => {
    router.go('login');
    expect(document.activeElement).toBe(field('server'));
    expect(field('server').value).toBe('');
  });
});

describe('login modes', () => {
  it('edit (no params / { edit }) pre-fills the current account and keeps the "YM Player" title', () => {
    seedAccount();
    router.go('login', { edit: true });
    expect(field('name').value).toBe('Home');
    expect(field('server').value).toBe('http://old.tv');
    expect(field('user').value).toBe('olga');
    expect(field('pass').value).toBe('pw');
    expect($('.login-title').textContent).toBe('YM Player');
    expect(document.activeElement).toBe(field('server'));
  });

  it('add shows "Add Account", blank fields and focuses the name', () => {
    seedAccount();
    router.go('login', { add: true });
    expect($('.login-title').textContent).toBe('Add Account');
    expect($('[data-action=login]').textContent).toBe('Add Account');
    expect(field('server').value).toBe('');
    expect(document.activeElement).toBe(field('name'));
  });

  it('add saves a second account with no user agent and makes it current', async () => {
    const a = seedAccount({ ua: 'Custom/1' });
    api.loginAt.mockResolvedValue(GOOD);
    router.go('login', { add: true });
    fill('name', 'Sports'); fill('server', 'new.tv'); fill('user', 'sam'); fill('pass', 'x');
    submit(); await tick();
    expect(store.accounts()).toHaveLength(2);
    expect(store.current()).toMatchObject({ name: 'Sports', server: 'http://new.tv', user: 'sam', ua: '', ok: true });
    expect(store.accounts().find((x) => x.id === a.id).ua).toBe('Custom/1');
  });

  it('edit updates the current account in place', async () => {
    const a = seedAccount({ ua: 'Custom/1' });
    api.loginAt.mockResolvedValue(GOOD);
    router.go('login', { edit: true });
    fill('pass', 'new');
    submit(); await tick();
    expect(store.accounts()).toHaveLength(1);
    expect(store.current()).toMatchObject({ id: a.id, pass: 'new', ua: 'Custom/1', ok: true });
  });
});

describe('login attempt (LoginActivity.attempt)', () => {
  it('validation: red "Please fill in the server, username and password." and no request', async () => {
    router.go('login');
    fill('server', 'h.tv');
    submit(); await tick();
    expect(api.loginAt).not.toHaveBeenCalled();
    expect(status().textContent).toBe('Please fill in the server, username and password.');
    expect(status().style.color).toBe('rgb(255, 122, 122)');
    expect(ERROR_COLOR).toBe('#FF7A7A');
  });

  it('shows "Connecting…" with the button disabled while it tries', async () => {
    let finish;
    api.loginAt.mockReturnValue(new Promise((r) => { finish = r; }));
    router.go('login');
    fill('server', 'h.tv'); fill('user', 'u'); fill('pass', 'p');
    submit(); await tick();
    expect(status().textContent).toBe('Connecting…');
    expect($('[data-action=login]').dataset.busy).toBe('true');
    submit(); // ignored while busy
    expect(api.loginAt).toHaveBeenCalledTimes(1);
    finish(GOOD); await tick();
  });

  it('a pasted get.php link fills empty username/password on submit', async () => {
    api.loginAt.mockResolvedValue(GOOD);
    router.go('login');
    fill('server', 'http://h.tv:8080/get.php?username=amy&password=pw1&type=m3u_plus');
    expect(field('user').value).toBe(''); // Android parses on submit, not on input
    submit(); await tick();
    expect(api.loginAt).toHaveBeenCalledWith('http://h.tv:8080', 'amy', 'pw1');
    expect(store.current()).toMatchObject({ server: 'http://h.tv:8080', user: 'amy', pass: 'pw1' });
  });

  it('a pasted link never overwrites a typed username', () => {
    expect(fromLink('h/get.php?username=a&password=b', 'typed', '')).toEqual({ u: 'typed', p: 'b' });
    expect(fromLink('h.tv', '', '')).toEqual({ u: '', p: '' });
  });

  it('tries the address as typed, then host only, then http/https swapped', async () => {
    expect(candidateBases('http://h.tv:8080/path')).toEqual(['http://h.tv:8080/path', 'http://h.tv:8080', 'https://h.tv:8080/path', 'https://h.tv:8080']);
    expect(candidateBases('http://h.tv')).toEqual(['http://h.tv', 'https://h.tv']);
    api.loginAt.mockImplementation(async (base) => {
      if (base === 'http://h.tv:8080') return GOOD;
      throw new TypeError('Failed to fetch');
    });
    router.go('login');
    fill('server', 'h.tv:8080/path'); fill('user', 'u'); fill('pass', 'p');
    submit(); await tick();
    expect(api.loginAt.mock.calls.map((c) => c[0])).toEqual(['http://h.tv:8080/path', 'http://h.tv:8080']);
    expect(store.current().server).toBe('http://h.tv:8080'); // the address that worked is saved
  });

  it('unreachable server: the detailed Android error with the last address tried', async () => {
    api.loginAt.mockRejectedValue(new TypeError('Failed to fetch'));
    router.go('login');
    fill('server', 'h.tv'); fill('user', 'u'); fill('pass', 'p');
    $('[data-action=login]').focus();
    submit(); await tick();
    expect(status().textContent).toBe("Couldn't log in: Couldn't connect to the server\nLast address tried: https://h.tv/player_api.php"
      + '\nCheck the server address with your provider — it should be just http://host:port');
    expect($('[data-action=login]').dataset.busy).toBeUndefined();
    expect(document.activeElement).toBe($('[data-action=login]'));
    expect(store.accounts()).toEqual([]);
    expect(router.current().name).toBe('login');
  });

  it('a response without user_info is "not like an Xtream server"', async () => {
    api.loginAt.mockResolvedValue({ server_info: {} });
    router.go('login');
    fill('server', 'h.tv'); fill('user', 'u'); fill('pass', 'p');
    submit(); await tick();
    expect(status().textContent).toContain("Couldn't log in: Server answered, but not like an Xtream server");
    expect(store.hasAccount()).toBe(false);
  });

  it('rejected login: "The server rejected the login … (account status: X)."', async () => {
    api.loginAt.mockResolvedValue({ user_info: { auth: 0, status: 'Banned' } });
    router.go('login');
    fill('server', 'h.tv'); fill('user', 'u'); fill('pass', 'p');
    submit(); await tick();
    expect(status().textContent).toBe('The server rejected the login — check your username and password (account status: Banned).');
    expect(store.accounts()).toEqual([]);
  });

  it('editing the server or user deletes the old library (and the guide listings); the same details keep it', async () => {
    const { seedLibrary } = await import('./helpers.js');
    const guide = await import('../js/guide.js');
    const clear = vi.spyOn(guide, 'clear');
    seedAccount();
    seedLibrary();
    const old = repo._backend().keys();
    expect(old).toHaveLength(6);
    api.loginAt.mockResolvedValue(GOOD);
    router.go('login', { edit: true });
    fill('pass', 'new'); // only the password: the library is still this account's
    submit(); await tick(); await tick();
    expect(repo._backend().keys()).toHaveLength(6);
    expect(clear).toHaveBeenCalledTimes(1);
    router.go('login', { edit: true });
    fill('server', 'other.tv');
    submit(); await tick(); await tick();
    expect(store.current().server).toBe('http://other.tv');
    expect(repo._backend().keys().filter((k) => old.includes(k))).toEqual([]);
    clear.mockRestore();
  });

  it('editing one of two accounts that share a library leaves it for the other', async () => {
    const { seedLibrary } = await import('./helpers.js');
    const a = seedAccount();
    const twin = { ...store.newAccount(), name: 'Twin', server: 'http://old.tv', user: 'olga', pass: 'pw', ok: true };
    store.saveAccount(twin); store.setCurrent(a.id);
    seedLibrary();
    api.loginAt.mockResolvedValue(GOOD);
    router.go('login', { edit: true });
    fill('user', 'someone-else');
    submit(); await tick(); await tick();
    expect(repo._backend().keys()).toHaveLength(6);
  });

  it('a failed edit leaves the saved account untouched', async () => {
    seedAccount();
    api.loginAt.mockRejectedValue(new Error('nope'));
    router.go('login', { edit: true });
    fill('pass', 'changed');
    submit(); await tick();
    expect(store.current()).toMatchObject({ pass: 'pw', ok: true });
  });

  it('success saves the account, clears the library memory and goes to Setup (clear task)', async () => {
    api.loginAt.mockResolvedValue(GOOD);
    const clear = vi.spyOn(repo, 'clear');
    router.go('settings');
    router.go('login');
    fill('name', '  Home  '); fill('server', 'host.tv:8080'); fill('user', 'bob'); fill('pass', 'secret');
    submit(); await tick();
    expect(store.current()).toMatchObject({ name: 'Home', server: 'http://host.tv:8080', user: 'bob', pass: 'secret', ok: true });
    expect(store.hasAccount()).toBe(true);
    expect(clear).toHaveBeenCalled();
    expect(router.current().name).toBe('setup');
    expect(router.stackDepth()).toBe(1);
    clear.mockRestore();
  });

  it('leaving the screen mid-attempt neither throws nor saves', async () => {
    let finish;
    api.loginAt.mockReturnValue(new Promise((r) => { finish = r; }));
    const errs = [];
    const h = (e) => errs.push(e);
    process.on('unhandledRejection', h);
    router.go('login');
    fill('server', 'h'); fill('user', 'u'); fill('pass', 'p');
    submit();
    router.go('home');
    finish(GOOD);
    await tick();
    process.off('unhandledRejection', h);
    expect(errs).toEqual([]);
    expect(store.accounts()).toEqual([]);
  });
});
