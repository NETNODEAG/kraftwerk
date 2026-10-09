/**
 * "Something a client shows has changed": domain code calls `changed()`
 * (a chat turn ended, a notification arrived, an update landed) without
 * knowing who listens. The server's live watches subscribe (`onChanged`)
 * and re-evaluate for the current workspace — the listener runs in the
 * caller's async context, so it sees the right one.
 */
const listeners = new Set<() => void>();

export function changed(): void {
  for (const fn of listeners) fn();
}

export function onChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
