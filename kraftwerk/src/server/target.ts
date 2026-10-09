import type http from "node:http";

/**
 * Which workspace a request is for. A workspace is addressed by its slug
 * (see workspaceSlug in config.ts), never by a port:
 *
 * - `<slug>.localhost[:port]` — the browser's form on this machine: every
 *   workspace its own origin, no setup (browsers resolve *.localhost here);
 * - `/w/<slug>/…` — the path form, one origin for all (where a host name per
 *   workspace is not available); the prefix is stripped before routing;
 * - neither — the server's own workspace (a port per workspace, as before).
 *
 * The socket names it per message instead (`ws`), see api/socket.ts.
 */
export interface Target {
  /** The slug the request named, if it named one. */
  slug?: string;
  /** The request's URL without the `/w/<slug>` prefix. */
  url: URL;
}

const PATH = /^\/w\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\/.*)?$/;

export function targetOf(req: http.IncomingMessage, url: URL): Target {
  const m = PATH.exec(url.pathname);
  if (m) {
    const rest = new URL(url.href);
    rest.pathname = m[2] ?? "/";
    return { slug: m[1], url: rest };
  }
  const host = req.headers.host ?? "";
  let name = "";
  try {
    name = new URL(`http://${host}`).hostname;
  } catch {}
  const label = name.endsWith(".localhost") ? name.slice(0, -".localhost".length) : "";
  // One label only: a.b.localhost names no workspace.
  return label && !label.includes(".") ? { slug: label, url } : { url };
}
