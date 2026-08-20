import { describe, expect, it } from 'vitest';
import { formatUtc, parseUtc } from '../parseUtc';

describe('parseUtc', () => {
  it('reads the BE timestamp as UTC, not local time', () => {
    // The BE writes UTC with no zone suffix. `new Date('2026-08-14T10:30:00')`
    // is parsed as LOCAL time by JS -- seven hours off in UTC+7, and wrong
    // silently. Asserting on epoch ms keeps this test correct in every zone,
    // which setting process.env.TZ at runtime would not (unreliable on Windows).
    expect(parseUtc('2026-08-14T10:30:00').getTime()).toBe(Date.UTC(2026, 7, 14, 10, 30, 0));
  });

  it('accepts the SQLite space-separated form too', () => {
    // `datetime('now')` defaults produce 'YYYY-MM-DD HH:MM:SS'.
    expect(parseUtc('2026-08-14 10:30:00').getTime()).toBe(Date.UTC(2026, 7, 14, 10, 30, 0));
  });
});

describe('formatUtc', () => {
  it('renders an em dash for a missing timestamp', () => {
    expect(formatUtc(null)).toBe('—');
  });

  it('renders a stable UTC string, not a locale-dependent one', () => {
    expect(formatUtc('2026-08-14T10:30:00')).toBe('2026-08-14 10:30:00');
  });
});
