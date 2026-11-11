// QR add-from-phone: shows the current account's connection details as a QR code.
import * as store from '../store.js';
import { toSvg } from '../vendor/qr.js';

/** Standard Xtream get.php URL carrying server, username and password. */
export function accountPayload(acc) {
  const server = String(acc.server || '').replace(/\/+$/, '');
  return `${server}/get.php?username=${encodeURIComponent(acc.user || '')}&password=${encodeURIComponent(acc.pass || '')}`;
}

export function phonelinkView() {
  return {
    mount(root) {
      const el = document.createElement('div');
      el.className = 'phonelink';
      const h = document.createElement('h2');
      h.textContent = 'Add from phone';
      el.appendChild(h);
      const acc = store.current();
      const p = document.createElement('p');
      if (!acc || !acc.server) {
        p.textContent = 'No account to share. Add an account first.';
        el.appendChild(p);
      } else {
        const payload = accountPayload(acc);
        el.dataset.payload = payload;
        const box = document.createElement('div');
        box.className = 'phonelink-qr';
        box.innerHTML = toSvg(payload, { scale: 6 });
        p.textContent = 'Scan with your phone to import this account. Press Back to close.';
        el.append(box, p);
      }
      root.appendChild(el);
    },
    unmount() {},
  };
}
