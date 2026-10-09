import type http from "node:http";
import { deviceForToken, type Device } from "../core/devices.js";

/**
 * Who is asking. Every request and socket gets one of:
 *
 * - `local`: this machine — a loopback peer that addresses a loopback name
 *   (localhost, 127.0.0.1, ::1) and was not forwarded by a proxy. Everything,
 *   device management included. The name matters: a page in this machine's
 *   browser can point its own domain at 127.0.0.1 (DNS rebinding), and its
 *   requests then come from loopback with Host evil.example — not local. A
 *   reverse proxy on this machine also connects from loopback; it says so in
 *   X-Forwarded-For/-Host/-Proto (a proxy that sends none of them must not be
 *   used — or set KRAFTWERK_UI_REQUIRE_PAIRING=1, which makes every request
 *   pair). Inside a container — where the published port mapping is the
 *   boundary — and with KRAFTWERK_UI_TRUST_NETWORK=1, other peers count as
 *   local too (the behaviour before devices existed).
 * - `device`: a paired device's token — `Authorization: Bearer` (apps),
 *   the `kw_device` cookie (a phone's browser, set on pairing), or `?token=`
 *   on the socket for runtimes whose WebSocket cannot send headers.
 * - `none`: anyone else. Gets the web UI's shell (to show the pairing
 *   screen), the protocol description and the pairing route — nothing else.
 */
export type Trust = { kind: "local" } | { kind: "device"; device: Device } | { kind: "none" };

export const DEVICE_COOKIE = "kw_device";

const LOOPBACK_PEER = /^(127\.|::1$|::ffff:127\.)/;
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The Host names a loopback name, and no proxy forwarded the request. */
function addressedLocally(req: http.IncomingMessage): boolean {
  if (req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"] || req.headers["x-forwarded-proto"] || req.headers.forwarded) return false;
  const host = req.headers.host;
  if (!host) return false;
  let name: string;
  try {
    name = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  return LOOPBACK_NAMES.has(name) || name.endsWith(".localhost");
}

/** The device token a request carries, if any. `?token=` only counts where asked (the socket). */
export function tokenOf(req: http.IncomingMessage, url: URL, allowQuery: boolean): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const cookie = req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${DEVICE_COOKIE}=`));
  if (cookie) return decodeURIComponent(cookie.slice(DEVICE_COOKIE.length + 1));
  return allowQuery ? (url.searchParams.get("token") ?? undefined) : undefined;
}

export interface TrustOptions {
  /** A loopback peer is this machine (default). Off, every request needs a token — for tests and hardened setups. */
  trustLoopback: boolean;
  /** Non-loopback peers count as local: a container behind its port mapping, or KRAFTWERK_UI_TRUST_NETWORK=1. */
  trustNetwork: boolean;
}

/** The request's trust: this machine (or a trusted network), else a paired device's token, else none. */
export async function trustOf(req: http.IncomingMessage, url: URL, opts: TrustOptions, allowQueryToken = false): Promise<Trust> {
  const peer = req.socket.remoteAddress ?? "";
  if ((opts.trustLoopback && LOOPBACK_PEER.test(peer) && addressedLocally(req)) || (opts.trustNetwork && !LOOPBACK_PEER.test(peer))) return { kind: "local" };
  const token = tokenOf(req, url, allowQueryToken);
  const device = token ? await deviceForToken(token) : null;
  return device ? { kind: "device", device } : { kind: "none" };
}
