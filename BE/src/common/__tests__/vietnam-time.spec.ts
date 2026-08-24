import { vietnamDateBoundaryUtc, vietnamDateKey } from '../time/vietnam-time';

describe('Vietnam time helpers', () => {
  it('moves an evening UTC timestamp into the next Vietnam calendar day', () => {
    expect(vietnamDateKey('2026-08-20 18:00:00')).toBe('2026-08-21');
  });

  it('converts a full Vietnam day into UTC database boundaries', () => {
    expect(vietnamDateBoundaryUtc('2026-08-02')).toBe('2026-08-01 17:00:00');
    expect(vietnamDateBoundaryUtc('2026-08-02', true)).toBe('2026-08-02 16:59:59');
  });
});
