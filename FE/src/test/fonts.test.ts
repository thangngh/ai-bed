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
