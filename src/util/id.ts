import { ulid, monotonicFactory } from 'ulid';

const monotonic = monotonicFactory();

export function newId(): string {
  return monotonic();
}

// Re-export the raw ulid for cases where monotonicity is not needed.
export { ulid as ulidNonMonotonic };
