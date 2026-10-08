import type { ApiName, ApiPath, ApiResult } from "../inspector/api/index.js";
import { ROUTES } from "./routes.js";

/**
 * The kraftwerk client: every control-plane route by name, typed by the
 * server's own handlers. Runs wherever `fetch` does — the web UI, Node (the
 * CLI), a native app's JS runtime. No server code is bundled: the route
 * table is generated (routes.ts), the types are erased.
 *
 *   const api = createClient();
 *   const project = await api.call("projects.get", { slug });
 *   await api.call("projects.log", { slug, body: { entry } });
 *
 * Path parameters go by name next to `query` and `body`. `call` throws an
 * ApiRequestError on any non-2xx answer; `request` returns the status and
 * body instead, for routes whose refusal carries a result (a 409 git commit,
 * a repository with unpushed work).
 */

export type { ApiName, ApiPath, ApiResult };
export { createLive, type Live, type LiveOptions, type WatchOptions } from "./live.js";

type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}` ? Name | ParamNames<`/${Rest}`> : P extends `${string}:${infer Name}` ? Name : never;
type PathParams<N extends ApiName> = { [K in ParamNames<ApiPath<N>>]: string };

export type Query = Record<string, string | number | boolean | undefined | null>;

/** What a call sends besides the path parameters. A Blob/File/ArrayBuffer body is sent as is (uploads), anything else as JSON. */
export interface CallExtras {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Let the request outlive the page (a save on tab close). */
  keepalive?: boolean;
}

export type CallInput<N extends ApiName> = PathParams<N> & CallExtras;

/** Routes without path parameters may omit the input. */
type InputArg<N extends ApiName> = [ParamNames<ApiPath<N>>] extends [never] ? [input?: CallInput<N>] : [input: CallInput<N>];

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly route: string,
  ) {
    const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
    super(typeof error === "string" && error ? error : `${route}: HTTP ${status}`);
  }
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  /** The result when ok; the error body (usually `{error}`) otherwise. */
  data: T;
}

export interface ClientOptions {
  /** Where the server is; "" (the default) is the page's own origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface Client {
  call<N extends ApiName>(name: N, ...input: InputArg<N>): Promise<ApiResult<N>>;
  request<N extends ApiName>(name: N, ...input: InputArg<N>): Promise<ApiResponse<ApiResult<N>>>;
  /** The URL of a route: for raw routes (a file to show or download, an event stream) and links. */
  url<N extends ApiName>(name: N, ...input: InputArg<N>): string;
}

export function createClient(opts: ClientOptions = {}): Client {
  const base = (opts.baseUrl ?? "").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  const url = (name: ApiName, input: Record<string, unknown> = {}): string => {
    const [, pattern] = ROUTES[name];
    const path = pattern.replace(/:([A-Za-z]+)/g, (_, key: string) => {
      const v = input[key];
      if (v === undefined || v === null || v === "") throw new Error(`${name}: missing path parameter ${key}`);
      return encodeURIComponent(String(v));
    });
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries((input.query as Query | undefined) ?? {})) if (v !== undefined && v !== null && v !== false) q.set(k, v === true ? "1" : String(v));
    const qs = q.toString();
    return `${base}${path}${qs ? `?${qs}` : ""}`;
  };

  const request = async (name: ApiName, input: Record<string, unknown> = {}): Promise<ApiResponse<unknown>> => {
    const [method] = ROUTES[name];
    const { body, headers = {}, signal, keepalive } = input as CallExtras;
    const raw = body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
    const res = await doFetch(url(name, input), {
      method,
      cache: "no-store",
      signal,
      keepalive,
      headers: { ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {}
    return { ok: res.ok, status: res.status, data };
  };

  return {
    url: ((name: ApiName, input?: Record<string, unknown>) => url(name, input)) as unknown as Client["url"],
    request: ((name: ApiName, input?: Record<string, unknown>) => request(name, input)) as unknown as Client["request"],
    call: (async (name: ApiName, input?: Record<string, unknown>) => {
      const r = await request(name, input);
      if (!r.ok) throw new ApiRequestError(r.status, r.data, name);
      return r.data;
    }) as unknown as Client["call"],
  };
}
