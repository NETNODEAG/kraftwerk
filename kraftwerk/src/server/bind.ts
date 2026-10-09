import { existsSync } from "node:fs";
import os from "node:os";

/**
 * Interface to bind. Loopback by default: the UI's chat runs coding agents
 * against the repo, so it does not appear on the LAN because someone started
 * it on a laptop in a café. Bound to the network (`kraftwerk ui --lan`, or
 * KRAFTWERK_UI_HOST), only paired devices get in (see trust.ts). Inside a container the
 * default flips to all interfaces — loopback there would make the published
 * port unreachable while the in-container health check keeps passing, and
 * the port mapping (compose publishes to 127.0.0.1) is the boundary anyway.
 * KRAFTWERK_UI_HOST overrides either way.
 */
export const IN_CONTAINER = existsSync("/.dockerenv") || existsSync("/run/.containerenv");
export const INSPECTOR_HOST = process.env.KRAFTWERK_UI_HOST || (IN_CONTAINER ? "0.0.0.0" : "127.0.0.1");
export const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export const LOOPBACK_BIND = LOOPBACK_NAMES.has(INSPECTOR_HOST);

/** Where a device on the network reaches this server: one http URL per non-internal IPv4 address. Empty while bound to loopback. */
export function networkUrls(port: number): string[] {
  if (LOOPBACK_BIND) return [];
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === "IPv4" && !a.internal)
    .map((a) => `http://${a.address}:${port}`);
}
