// Time is injected so services and tests agree on "now". A clock is any object with
// `now()` returning milliseconds since the epoch.

export const systemClock = Object.freeze({ now: () => Date.now() });

/** A clock that only moves when told to; used by tests and the CLI. */
export function createManualClock(start = Date.UTC(2026, 0, 5, 9, 0, 0)) {
  let current = start;
  return {
    now: () => current,
    set(value) {
      current = value;
    },
    advance(milliseconds) {
      current += milliseconds;
    },
    advanceMinutes(minutes) {
      current += minutes * 60_000;
    },
  };
}
