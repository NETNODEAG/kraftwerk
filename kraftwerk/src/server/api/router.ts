import type http from "node:http";
import * as z from "zod";
import { touch } from "../live.js";

/**
 * The API's routing: every endpoint is one named route — an RPC-style name
 * (`projects.get`), an HTTP method + path pattern, and a handler that
 * returns its result instead of writing the response. The name and the
 * result type are the contract other clients build on (see api/index.ts);
 * HTTP is one transport for it. Handlers that must own the response — SSE
 * streams, file downloads, raw uploads — are marked `raw` and write to
 * `c.res` themselves.
 *
 * A route with a `body` schema (zod) gets its JSON body validated before
 * the handler runs — a mismatch is a 400 naming the field — and `c.body()`
 * returns the parsed value with the schema's type. Clients see the
 * schema's input type for `body` (api/index.ts `ApiBody`).
 */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Ctx<B = Record<string, unknown>> {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  /** Path parameters, already URI-decoded (`:slug` → params.slug). */
  params: Record<string, string>;
  query: URLSearchParams;
  /** The JSON body (parsed by the route's schema when it has one); an empty body is `{}`, malformed JSON a 400. Read once. */
  body<T = B>(): Promise<T>;
}

/** A result with a status other than 200 (201 created, 409 with a body, …). */
export class Reply<B> {
  constructor(readonly status: number, readonly body: B) {}
}
export const reply = <B>(status: number, body: B): Reply<B> => new Reply(status, body);

/** A refusal with a status; the body is `{error}` unless given. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown = { error: message }) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}

export interface RouteDef<N extends string, P extends string = string, S extends z.ZodType | undefined = z.ZodType | undefined> {
  name: N;
  method: Method;
  /** `/api/projects/:slug/log` — literal segments win over parameters. */
  path: P;
  summary: string;
  /** Status for an Error the handler throws (not an ApiError); default 500. */
  errors?: number | ((message: string) => number);
  /** The handler writes the response itself (streams, files). HTTP only. */
  raw?: boolean;
  /** The request body is the bytes of a file (`c.req`), not JSON. HTTP only. */
  upload?: boolean;
  /** The JSON body's schema: validated before the handler, typed for clients. */
  body?: S;
}

/** What `c.body()` returns: the schema's output, else a loose object. */
export type BodyOf<S> = S extends z.ZodType ? z.output<S> : Record<string, unknown>;

export interface Route<N extends string = string, R = unknown, P extends string = string, S extends z.ZodType | undefined = z.ZodType | undefined> extends RouteDef<N, P, S> {
  handle(c: Ctx<BodyOf<S>>): Promise<R>;
}

export function route<const N extends string, R, const P extends string, S extends z.ZodType | undefined = undefined>(
  def: RouteDef<N, P, S>,
  handle: (c: Ctx<BodyOf<S>>) => Promise<R>,
): Route<N, R, P, S> {
  return { ...def, handle };
}

/** A route's body schema input: what a client sends. */
export type BodyInputOf<R> = R extends Route<string, unknown, string, infer S> ? (S extends z.ZodType ? z.input<S> : unknown) : never;

/** Validate a body against the route's schema: the parsed value, or a 400 naming what is wrong. */
function validate(route: Route, raw: unknown): unknown {
  if (!route.body) return raw;
  const r = route.body.safeParse(raw);
  if (!r.success) throw new ApiError(400, z.prettifyError(r.error));
  return r.data;
}

/** The 200 body of a route's result. */
export type ResultOf<R> = R extends Route<string, infer T, string, z.ZodType | undefined> ? (T extends Reply<infer B> ? B : T) : never;
/** A route's path pattern, as a literal type. */
export type PathOf<R> = R extends Route<string, unknown, infer P, z.ZodType | undefined> ? P : never;

/** Maps an error message to a status by the usual wording: "no <thing>" is 404, "… are off" 409, else 400. */
export const statusByMessage =
  (missing: RegExp) =>
  (message: string): number =>
    missing.test(message) ? 404 : /are off/.test(message) ? 409 : 400;

interface Compiled {
  route: Route;
  parts: string[];
  /** Literal segments score higher, so `/channels/from-chat` beats `/channels/:slug`. */
  rank: number;
}

export interface Router {
  routes: readonly Route[];
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void>;
  /**
   * Run a route by name without HTTP (the socket): path parameters by name,
   * `query` and `body` beside them. Raw and upload routes are refused.
   */
  invoke(name: string, input: Record<string, unknown>): Promise<{ status: number; data: unknown }>;
}

/** What a thrown error becomes: an ApiError's status and body, else the route's mapping. */
function failure(route: Route, err: unknown): { status: number; data: unknown } {
  if (err instanceof ApiError) return { status: err.status, data: err.body };
  const message = (err as Error).message;
  return { status: typeof route.errors === "function" ? route.errors(message) : (route.errors ?? 500), data: { error: message } };
}

export function json(res: http.ServerResponse, body: unknown, status = 200): void {
  // A late error on an SSE response must not try to write headers again.
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new ApiError(413, "body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** A raw upload body (attachments), capped at `max` bytes. */
export function readRawBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error(`file too large (max ${Math.round(max / 1_000_000)} MB)`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ApiError(400, "malformed path");
  }
}

export function createRouter(routes: readonly Route[]): Router {
  const names = new Set<string>();
  const compiled: Compiled[] = routes.map((route) => {
    if (names.has(route.name)) throw new Error(`duplicate route name ${route.name}`);
    names.add(route.name);
    const parts = route.path.split("/").filter(Boolean);
    return { route, parts, rank: parts.reduce((n, p, i) => n + (p.startsWith(":") ? 0 : 2 ** (parts.length - i)), 0) };
  });
  compiled.sort((a, b) => b.rank - a.rank);
  const byName = new Map(routes.map((r) => [r.name, r]));

  const match = (method: string, seg: string[]): { route: Route; params: Record<string, string> } | undefined => {
    for (const c of compiled) {
      if (c.route.method !== method || c.parts.length !== seg.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < seg.length && ok; i++) {
        if (c.parts[i].startsWith(":")) params[c.parts[i].slice(1)] = seg[i];
        else ok = c.parts[i] === seg[i];
      }
      if (ok) return { route: c.route, params };
    }
    return undefined;
  };

  return {
    routes,
    async handle(req, res, url) {
      const seg = url.pathname.split("/").filter(Boolean);
      const found = match(req.method ?? "GET", seg);
      if (!found) return json(res, { error: "not found" }, 404);
      const { route } = found;
      let bodyRead: Promise<unknown> | undefined;
      try {
        const params = Object.fromEntries(Object.entries(found.params).map(([k, v]) => [k, decode(v)]));
        const c: Ctx = {
          req,
          res,
          url,
          params,
          query: url.searchParams,
          body: <T>() =>
            (bodyRead ??= readBody(req).then((raw) => {
              if (!raw.trim()) return validate(route, {});
              let parsed: unknown;
              try {
                parsed = JSON.parse(raw);
              } catch {
                throw new ApiError(400, "invalid JSON body");
              }
              return validate(route, parsed);
            })) as Promise<T>,
        };
        const result = await route.handle(c);
        if (route.method !== "GET") touch();
        if (route.raw) return;
        if (result instanceof Reply) return json(res, result.body, result.status);
        return json(res, result);
      } catch (err) {
        const f = failure(route, err);
        return json(res, f.data, f.status);
      }
    },
    async invoke(name, input) {
      const route = byName.get(name);
      if (!route) return { status: 404, data: { error: `no route ${name}` } };
      if (route.raw || route.upload) return { status: 400, data: { error: `${name} is HTTP only` } };
      try {
        const params: Record<string, string> = {};
        for (const p of route.path.split("/")) if (p.startsWith(":")) params[p.slice(1)] = String(input[p.slice(1)] ?? "");
        const query = new URLSearchParams();
        for (const [k, v] of Object.entries((input.query as Record<string, unknown> | undefined) ?? {}))
          if (v !== undefined && v !== null && v !== false) query.set(k, v === true ? "1" : String(v));
        const c: Ctx = {
          // No HTTP request behind an invoke; only raw and upload routes read these.
          req: undefined as never,
          res: undefined as never,
          url: new URL(`http://invoke${route.path}`),
          params,
          query,
          body: async <T>() => validate(route, input.body ?? {}) as T,
        };
        const result = await route.handle(c);
        if (route.method !== "GET") touch();
        return result instanceof Reply ? { status: result.status, data: result.body } : { status: 200, data: result };
      } catch (err) {
        return failure(route, err);
      }
    },
  };
}
