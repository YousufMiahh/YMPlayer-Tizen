import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const xml = readFileSync(resolve(process.cwd(), 'config.xml'), 'utf8');
const doc = new DOMParser().parseFromString(xml, 'application/xml');

describe('config.xml', () => {
  it('parses as well-formed XML', () => {
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    expect(doc.documentElement.localName).toBe('widget');
  });

  it('targets Tizen 7.0 and declares the app id/package', () => {
    const app = doc.getElementsByTagName('tizen:application')[0];
    expect(app.getAttribute('required_version')).toBe('7.0');
    expect(app.getAttribute('id')).toMatch(/^[A-Za-z0-9]{10}\.\w+$/);
    expect(app.getAttribute('package')).toBe(app.getAttribute('id').split('.')[0]);
  });

  it('declares the privileges the app needs', () => {
    const privs = [...doc.getElementsByTagName('tizen:privilege')].map((p) => p.getAttribute('name'));
    expect(privs).toContain('http://tizen.org/privilege/internet');
    expect(privs).toContain('http://tizen.org/privilege/tv.inputdevice');
  });

  it('allows network access to any origin', () => {
    const access = doc.getElementsByTagName('access')[0];
    expect(access).toBeTruthy();
    expect(access.getAttribute('origin')).toBe('*');
  });

  it('points at an existing entry page', () => {
    expect(doc.getElementsByTagName('content')[0].getAttribute('src')).toBe('index.html');
  });
});
