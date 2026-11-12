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

  it('theme.css declares the Ui.java design tokens', () => {
    const css = read('../css/theme.css').replace(/\s+/g, '');
    expect(css).toContain('--u:1.4px');
    expect(css).toContain('--bg:#0A0B12');       // Ui.BG (dark)
    expect(css).toContain('--bg-top:#1C2040');
    expect(css).toContain('--focus-bg:#FFFFFF');
    expect(css).toContain('--on-focus:#0B0B0F');
    expect(css).toContain('--accent:#0A84FF');   // EPG now-line only
    expect(css).toContain('html.light{--bg:#F2F2F7');
    expect(css).toMatch(/--font:[^;]*Inter/);
  });

  it('no stylesheet draws the old blue focus outline/glow', () => {
    for (const f of ['theme', 'ui', 'home', 'browse', 'login', 'search', 'settings', 'extras', 'detail']) {
      const css = read(`../css/${f}.css`);
      expect(css, f).not.toMatch(/rgba\(10,\s*132,\s*255/);
      expect(css, f).not.toMatch(/border-color:\s*var\(--accent\)/);
      expect(css, f).not.toMatch(/#ffd60a/i);
    }
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
