import type http from "node:http";

/**
 * A daemon that kraftwerk cloud runs for a workspace — "launch" on the
 * platform: the cloud starts a sandbox (a container or microVM) on its own
 * hardware with this daemon in it, which joins the workspace like any other
 * machine (`kraftwerk join`). People reach its UI through the cloud, which
 * forwards a public origin of the sandbox's own (e.g.
 * https://<id>.run.kraftwerk-cloud…) here with the Host as the browser sent it.
 *
 *   KRAFTWERK_PUBLIC_ORIGIN     that origin; set, the daemon is a sandbox
 *   KRAFTWERK_PUBLIC_CLOUD_URL  the cloud as the browser reaches it, when the
 *                               sandbox reaches it at another address (locally:
 *                               host.docker.internal) — the sign-in goes there
 *
 * In a sandbox, everyone arriving from outside is a person who signs in with
 * their cloud account — whatever the workspace's `users:` says, and whether
 * or not the request looks like a browser (users.ts fromBrowser lets the
 * machine's own scripts through; here the network is not the machine's).
 * Only what runs inside the sandbox itself (its agents' CLI, on loopback)
 * is the machine. A request without a workspace in its Host reaches the
 * sandbox's one workspace.
 */

const LOOPBACK_PEER = /^(127\.|::1$|::ffff:127\.)/;

/** The public origin, when this daemon is a sandbox; read each time (tests set it). */
export function sandboxOrigin(): URL | null {
  const raw = process.env.KRAFTWERK_PUBLIC_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Where the browser signs in: the cloud as people reach it. */
export const browserCloudUrl = (machineCloudUrl: string): string =>
  sandboxOrigin() && process.env.KRAFTWERK_PUBLIC_CLOUD_URL?.trim() ? process.env.KRAFTWERK_PUBLIC_CLOUD_URL.trim().replace(/\/+$/, "") : machineCloudUrl;

/** The request came in on the public origin (through the cloud). */
export function viaPublicOrigin(req: http.IncomingMessage): boolean {
  const o = sandboxOrigin();
  return !!o && String(req.headers.host ?? "").toLowerCase() === o.host.toLowerCase();
}

/** A sandbox, and this request is from outside it: a person, who signs in. */
export function fromOutside(req: http.IncomingMessage): boolean {
  if (!sandboxOrigin()) return false;
  return viaPublicOrigin(req) || !LOOPBACK_PEER.test(req.socket.remoteAddress ?? "");
}
