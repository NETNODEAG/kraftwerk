import * as z from "zod";
import { agentRoutes } from "./agents.js";
import { attentionRoutes } from "./attention.js";
import { channelRoutes } from "./channels.js";
import { chatRoutes } from "./chats.js";
import { deviceRoutes } from "./devices.js";
import { fileRoutes } from "./files.js";
import { gitRoutes } from "./git.js";
import { knowledgeRoutes } from "./knowledge.js";
import { projectRoutes } from "./projects.js";
import { createRouter, route, type BodyInputOf, type PathOf, type ResultOf, type Route } from "./router.js";
import { runRoutes } from "./runs.js";
import { vibeableRoutes } from "./vibeables.js";
import { workspaceRoutes } from "./workspace.js";

/**
 * The control plane's contract. Every route has a stable name; clients
 * (the web UI today, a native app or the CLI later) address it by that name
 * and get the handler's return type as its result — inferred, so the
 * contract cannot drift from the implementation. Bump PROTOCOL_VERSION when
 * a route is removed or its result changes incompatibly; adding routes or
 * fields is not a bump.
 */
export const PROTOCOL_VERSION = 1;

const domainRoutes = [
  ...workspaceRoutes,
  ...attentionRoutes,
  ...agentRoutes,
  ...chatRoutes,
  ...channelRoutes,
  ...projectRoutes,
  ...runRoutes,
  ...knowledgeRoutes,
  ...fileRoutes,
  ...gitRoutes,
  ...vibeableRoutes,
  ...deviceRoutes,
];

/** One line per route, for clients and people: what exists and how to reach it. */
export interface RouteInfo {
  name: string;
  method: string;
  path: string;
  summary: string;
  /** A stream or a file, not a JSON result. */
  raw?: boolean;
  /** The body is a file's bytes. */
  upload?: boolean;
  /** The JSON body's shape as JSON Schema, for clients that cannot use the TypeScript types. */
  body?: unknown;
}

const protocolRoute = route({ name: "protocol.get", method: "GET", path: "/api/protocol", summary: "the protocol version and every route", access: "public" }, async () => ({
  version: PROTOCOL_VERSION,
  routes: describe(),
}));

function describe(): RouteInfo[] {
  return (routes as readonly Route[]).map(({ name, method, path, summary, raw, upload, body }) => ({
    name,
    method,
    path,
    summary,
    ...(raw ? { raw } : {}),
    ...(upload ? { upload } : {}),
    // What a client sends: the schema's input side (defaults may be left out).
    ...(body ? { body: z.toJSONSchema(body, { io: "input", unrepresentable: "any" }) } : {}),
  }));
}

export const routes = [protocolRoute, ...domainRoutes];
export const apiRouter = createRouter(routes as readonly Route[]);

type AnyRoute = (typeof routes)[number];
/** Every route name. */
export type ApiName = AnyRoute["name"];
/** The result of route `N` (its 200 body). */
export type ApiResult<N extends ApiName> = ResultOf<Extract<AnyRoute, { name: N }>>;
/** The path pattern of route `N` (`/api/projects/:slug`). */
export type ApiPath<N extends ApiName> = PathOf<Extract<AnyRoute, { name: N }>>;
/** What route `N` takes as its JSON body (its zod schema's input; `unknown` without one). */
export type ApiBody<N extends ApiName> = BodyInputOf<Extract<AnyRoute, { name: N }>>;
