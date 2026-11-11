import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { boot } from '../js/app.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('scaffold smoke test', () => {
  it('exports boot as a function', () => {
    expect(typeof boot).toBe('function');
  });

  it('boot renders into the given root element', () => {
    const root = document.createElement('div');
    boot(root);
    expect(root.children.length).toBeGreaterThan(0);
  });

  it('theme.css declares the exact design tokens', () => {
    const css = read('../css/theme.css');
    expect(css).toContain('--bg:#0B0B0F');
    expect(css).toContain('--accent:#0A84FF');
    expect(css).toMatch(/--font:[^;]*Inter/);
  });

  it('config.xml targets Tizen 7.0 with required privileges', () => {
    const xml = read('../config.xml');
    expect(xml).toMatch(/<access\s+origin="\*"/);
    expect(xml).toContain('required_version="7.0"');
    for (const p of ['internet', 'tv.inputdevice', 'application.launch']) {
      expect(xml).toContain(`http://tizen.org/privilege/${p}`);
    }
  });
});
