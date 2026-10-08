import { useEffect, useRef, useState } from "react";
import { ApiRequestError, createClient, createLive, type ApiName, type ApiResult, type CallInput } from "../../src/client";

/**
 * The web UI's way to the server: the kraftwerk client (src/client) for
 * this page's origin. Screens call routes by name — `api.call("projects.get",
 * { slug })` — and never build /api URLs or call fetch themselves; the
 * result types are the server handlers' own.
 */
export const api = createClient();
/** The page's one socket: watched results and event streams (see src/client/live.ts). */
export const live = createLive({ client: api });
export { ApiRequestError };
export type { ApiName, ApiResult, CallInput };

/** What went wrong with a `request`: the server's `{error}`, else `HTTP <status>` when not ok, else "". */
export function failure(r: { ok: boolean; status: number; data: unknown }): string {
  const error = (r.data as { error?: unknown } | null | undefined)?.error;
  return typeof error === "string" && error ? error : r.ok ? "" : `HTTP ${r.status}`;
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
