import * as z from "zod";
import { createPairCode, listDevices, redeemPairCode, revokeDevice } from "../../core/devices.js";
import { networkUrls } from "../bind.js";
import { currentHub } from "../hub-context.js";
import { applyRelay, keyFingerprint, readRelaySettings, relayStatus, remoteLink, setRelay } from "../relay.js";
import { getPkgVersion } from "../version.js";
import { DEVICE_COOKIE } from "../trust.js";
import { ApiError, fail, reply, route } from "./router.js";

/** Failed pairing attempts per peer, to make guessing a code pointless: a code is 8 characters from 31 and lives 10 minutes. */
const failures = new Map<string, number[]>();
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60_000;

function guard(peer: string): void {
  const now = Date.now();
  const recent = (failures.get(peer) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  failures.set(peer, recent);
  if (recent.length >= MAX_FAILURES) fail(429, "too many wrong pairing codes — wait a few minutes");
}

/** Paired devices: other machines that use this one's kraftwerk (see core/devices.ts). */
export const deviceRoutes = [
  // Public: an unpaired device trades a code for its token. A browser also gets the token as an
  // HttpOnly cookie, so previews, downloads and the socket work without script access to it.
  route(
    {
      name: "devices.pair",
      method: "POST",
      path: "/api/pair",
      summary: "trade a pairing code {code, name} for a device token",
      access: "public",
      body: z.object({ code: z.string().min(1), name: z.string().default("") }),
    },
    async (c) => {
      const peer = c.req?.socket.remoteAddress ?? "socket";
      guard(peer);
      const { code, name } = await c.body();
      try {
        const paired = await redeemPairCode(code, name);
        const secure = c.req?.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
        return reply(200, paired, {
          "set-cookie": `${DEVICE_COOKIE}=${encodeURIComponent(paired.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000${secure}`,
        });
      } catch (err) {
        failures.get(peer)?.push(Date.now()) ?? failures.set(peer, [Date.now()]);
        throw new ApiError(400, (err as Error).message);
      }
    },
  ),
  route({ name: "devices.self", method: "GET", path: "/api/devices/self", summary: "how this caller is trusted: this machine or a paired device" }, async (c) => ({
    trust: c.trust.kind,
    ...(c.trust.kind === "device" ? { device: c.trust.device } : {}),
  })),
  route({ name: "devices.list", method: "GET", path: "/api/devices", summary: "every paired device", access: "local" }, async () => ({ devices: await listDevices() })),
  // The code is shown once; the addresses are where a device on the network opens kraftwerk (none while bound to this machine only),
  // and with the relay on, `remote` is the link that pairs a device from anywhere (code and machine key in its fragment).
  route({ name: "devices.code", method: "POST", path: "/api/devices/code", summary: "a one-time pairing code, valid 10 minutes", access: "local" }, async (c) => {
    const pair = await createPairCode();
    const relay = await readRelaySettings();
    return {
      ...pair,
      urls: networkUrls(c.req?.socket.localPort ?? 0),
      ...(relay?.enabled ? { remote: remoteLink(relay.url, relay.publicKey, pair.code) } : {}),
    };
  }),
  route({ name: "devices.relay", method: "GET", path: "/api/devices/relay", summary: "the relay: whether devices reach this machine from anywhere, and the link's state", access: "local" }, async () => {
    const s = await readRelaySettings();
    return {
      enabled: s?.enabled === true,
      url: s?.url ?? null,
      fingerprint: s ? keyFingerprint(s.publicKey) : null,
      daemon: currentHub().daemon === true,
      ...relayStatus(),
    };
  }),
  // Only the daemon holds the link; a standalone `kraftwerk ui` saves the setting for the daemon's next start.
  route(
    {
      name: "devices.setRelay",
      method: "POST",
      path: "/api/devices/relay",
      summary: "turn the relay on or off {enabled, url?}",
      access: "local",
      body: z.object({ enabled: z.boolean(), url: z.string().url().optional() }),
    },
    async (c) => {
      const { enabled, url } = await c.body();
      const s = await setRelay(enabled, url);
      const hub = currentHub();
      const status = hub.daemon ? await applyRelay(hub.port, await getPkgVersion(), (l) => console.log(l)) : relayStatus();
      return { enabled: s.enabled, url: s.url, fingerprint: keyFingerprint(s.publicKey), daemon: hub.daemon === true, ...status };
    },
  ),
  route({ name: "devices.revoke", method: "DELETE", path: "/api/devices/:id", summary: "unpair a device: its token stops working at once", access: "local" }, async (c) =>
    (await revokeDevice(c.params.id)) ? { ok: true } : fail(404, "no such device"),
  ),
];
