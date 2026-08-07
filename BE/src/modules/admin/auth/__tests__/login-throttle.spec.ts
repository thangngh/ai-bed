import { LoginThrottle } from '../login-throttle';

/** A hand-cranked clock, so no test ever waits on a real 15-minute window. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const WINDOW = 15 * 60 * 1000;

describe('LoginThrottle', () => {
  it('allows the first attempt for an unseen username', () => {
    const throttle = new LoginThrottle();
    expect(throttle.check('thang')).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('allows up to 10 failures and blocks the 11th attempt', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(10, WINDOW, clock.now);

    for (let i = 0; i < 10; i++) {
      expect(throttle.check('thang').allowed).toBe(true);
      throttle.recordFailure('thang');
    }

    const decision = throttle.check('thang');
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it('reports a shrinking retry_after as the window drains', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(1, WINDOW, clock.now);
    throttle.recordFailure('thang');
    clock.advance(60_000);
    expect(throttle.check('thang').retryAfterSeconds).toBe(840);
  });

  it('clears the count on a successful login', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(2, WINDOW, clock.now);
    throttle.recordFailure('thang');
    throttle.recordFailure('thang');
    expect(throttle.check('thang').allowed).toBe(false);

    throttle.recordSuccess('thang');
    expect(throttle.check('thang')).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('reopens once the window has fully elapsed', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(1, WINDOW, clock.now);
    throttle.recordFailure('thang');
    expect(throttle.check('thang').allowed).toBe(false);

    clock.advance(WINDOW);
    expect(throttle.check('thang').allowed).toBe(true);
  });

  it('counts usernames independently and case-insensitively', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(1, WINDOW, clock.now);
    throttle.recordFailure('thang');

    expect(throttle.check('thang').allowed).toBe(false);
    // Same account, different spelling -- must not reset the counter.
    expect(throttle.check('  THANG ').allowed).toBe(false);
    expect(throttle.check('someone-else').allowed).toBe(true);
  });
});
