import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiRequestError, createClient, createLive, type ApiName, type ApiResponse, type ApiResult, type CallInput } from "../../src/client";

/**
 * The web UI's way to the server: the kraftwerk client (src/client) for
 * this page's origin. Screens call routes by name — `api.call("projects.get",
 * { slug })` — and never build /api URLs or call fetch themselves; the
 * result types are the server handlers' own.
 */
/* ---------- pairing ---------- */

let unpaired = false;
const pairingListeners = new Set<() => void>();

/** True once the server said this browser is not a paired device (on the network, not on its machine): show the pairing screen. */
export function usePairingNeeded(): boolean {
  return useSyncExternalStore(
    (fn) => {
      pairingListeners.add(fn);
      return () => pairingListeners.delete(fn);
    },
    () => unpaired,
  );
}

export const api = createClient({
  onUnauthorized: () => {
    if (unpaired) return;
    unpaired = true;
    for (const fn of pairingListeners) fn();
  },
});
/** The page's one socket: watched results and event streams (see src/client/live.ts). */
export const live = createLive({ client: api });
export { ApiRequestError };
export type { ApiName, ApiResponse, ApiResult, CallInput };

/** What went wrong with a `request`: the server's message, else `HTTP <status>`; "" when it went through. */
export function failure(r: ApiResponse<unknown>): string {
  return r.ok ? "" : (r.error ?? `HTTP ${r.status}`);
}

export interface UseApiOptions {
  /** Refetch every 1.5 s instead of `interval` (something is running). */
  fast?: boolean;
  /** Poll interval in ms (default 6 s). */
  interval?: number;
  /** Changing it refetches at once (after a mutation the screen knows about). */
  refresh?: unknown;
}

/**
 * A route's result, kept current: pushed over the socket whenever it
 * changes (polled over HTTP while there is no socket). `null` until the
 * first answer; a failed fetch keeps the last good value. Passing `null` as
 * input pauses it (a screen that only needs the data in one state); a
 * changed input or `refresh` restarts it, which delivers the current value
 * at once.
 */
export function useApi<N extends ApiName>(name: N, input: CallInput<N> | null, opts: UseApiOptions = {}): ApiResult<N> | null {
  const [data, setData] = useState<ApiResult<N> | null>(null);
  const key = input === null ? "" : `${name} ${JSON.stringify(input)}`;
  const inputRef = useRef(input);
  inputRef.current = input;
  const { fast = false, interval = 6000, refresh } = opts;

  useEffect(() => {
    if (!key) return;
    return live.watch(name, inputRef.current ?? undefined, { interval: fast ? 1500 : interval }, setData);
  }, [key, fast, interval, refresh]);

  return data;
}
