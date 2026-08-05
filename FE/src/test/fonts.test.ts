import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// These tests read the repository, not the DOM. They exist because a missing
// or misnamed font file produces no error anywhere in the toolchain: `tsc
// --noEmit` is silent, `vite build` is silent, and the page merely falls back
// to a system font -- which looks plausible enough to ship unnoticed.
const FONTS_DIR = join(process.cwd(), 'public', 'fonts');

const WEIGHTS = ['regular', '500', '600', '700', '800'] as const;

describe('font assets', () => {
  it('ships one woff2 per required weight', () => {
    const files = existsSync(FONTS_DIR) ? readdirSync(FONTS_DIR) : [];
    const woff2 = files.filter((f) => f.endsWith('.woff2'));

    for (const weight of WEIGHTS) {
      const match = woff2.filter((f) => f.endsWith(`-${weight}.woff2`));
      expect(match, `expected exactly one woff2 for weight "${weight}", got ${JSON.stringify(match)}`).toHaveLength(1);
    }
    expect(woff2, 'no extra weights should be shipped').toHaveLength(WEIGHTS.length);
  });

  it('ships only the latin+vietnamese charset build', () => {
    const woff2 = readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2'));
    for (const file of woff2) {
      expect(file, `${file} must be the merged latin_vietnamese build`).toContain('latin_vietnamese');
    }
  });
});

describe('OFL compliance', () => {
  it('publishes the license beside the fonts', () => {
    expect(existsSync(join(FONTS_DIR, 'OFL.txt'))).toBe(true);
  });

  it('reproduces the copyright line verbatim', () => {
    const text = readFileSync(join(FONTS_DIR, 'OFL.txt'), 'utf8');
    expect(text).toContain(
      'Copyright 2021 The Be Vietnam Pro Project Authors (https://github.com/bettergui/BeVietnamPro)',
    );
    expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });
});

describe('index.css font wiring', () => {
  const css = () => readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

  it('declares one @font-face per required weight', () => {
    const source = css();
    const faces = source.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(WEIGHTS.length);

    const declared = faces
      .map((face) => face.match(/font-weight:\s*(\d+)/)?.[1])
      .sort();
    expect(declared).toEqual(['400', '500', '600', '700', '800']);
  });

  it('points every url() at a file that exists', () => {
    const urls = [...css().matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
    expect(urls.length, 'expected at least one url() in index.css').toBeGreaterThan(0);

    for (const url of urls) {
      // Served from public/, so a leading /fonts/ maps to public/fonts/.
      const onDisk = join(process.cwd(), 'public', url.replace(/^\//, ''));
      expect(existsSync(onDisk), `${url} is referenced by index.css but ${onDisk} does not exist`).toBe(true);
    }
  });

  it('swaps rather than hiding text while the font loads', () => {
    const faces = css().match(/@font-face\s*\{[^}]*\}/g) ?? [];
    for (const face of faces) {
      expect(face, 'every @font-face needs font-display: swap').toMatch(/font-display:\s*swap/);
    }
  });

  it('overrides the Tailwind sans stack', () => {
    // Order is load-bearing, not just presence: CSS resolves a font-family
    // stack left-to-right, so "Be Vietnam Pro" must be the FIRST entry. A
    // stack like `--font-sans: ui-sans-serif, "Be Vietnam Pro", ...` would
    // satisfy a naive "does the value contain the string" check yet every
    // browser would render in ui-sans-serif -- silently defeating the entire
    // feature with no error anywhere. Extract the declaration's value and
    // assert on its first comma-separated entry rather than pattern-matching
    // the whole thing, so reordering is actually caught.
    const source = css();
    const declaration = source.match(/@theme\s*\{[^}]*--font-sans:\s*([^;]+);/s);
    expect(declaration, '--font-sans declaration not found inside an @theme block').not.toBeNull();

    const stack = declaration![1].split(',').map((entry) => entry.trim());
    expect(
      stack[0],
      '"Be Vietnam Pro" must be the first entry in --font-sans, not merely present somewhere in it',
    ).toBe('"Be Vietnam Pro"');

    // The fallbacks are what render during the swap window and if the font
    // request fails outright; losing them silently would also be a regression.
    expect(stack.length, 'expected fallback families to remain after "Be Vietnam Pro"').toBeGreaterThan(1);
  });
});
