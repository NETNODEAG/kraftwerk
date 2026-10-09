import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { acceptWebSocket, type Socket } from "../../src/server/ws.js";

/**
 * A relay for tests, speaking the protocol of src/server/relay.ts (daemon
 * side) and src/client/relay.ts (client side) — what kraftwerk cloud runs in
 * production (its src/relay.ts, pinned by its own tests). It pipes; it
 * cannot read. `seen` records every message it carried, so a test can check
 * that nothing readable went through.
 */
export interface TestRelay {
  url: string;
  seen: string[];
  /** Drop the machine's socket (the relay restarts, the network breaks). */
  kick(id: string): void;
  close(): Promise<void>;
}

const idOf = (key: string): string | null => {
  try {
    const raw = Buffer.from(key, "base64url");
    return raw.length === 32 ? createHash("sha256").update(raw).digest().subarray(0, 16).toString("base64url") : null;
  } catch {
    return null;
  }
};

export async function startTestRelay(): Promise<TestRelay> {
  const secrets = new Map<string, string>();
  const servers = new Map<string, Socket>();
  const clients = new Map<string, { id: string; ws: Socket }>();
  const seen: string[] = [];
  const server = http.createServer((_req, res) => res.writeHead(404).end());

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://relay");
    if (url.pathname === "/api/relay/server") {
      const ws = acceptWebSocket(req, socket, head);
      if (!ws) return;
      let id = "";
      ws.onMessage((text) => {
        seen.push(text);
        const msg = JSON.parse(text) as { t: string; id?: string; key?: string; secret?: string; c?: string; d?: string; reason?: string };
        if (!id) {
          if (msg.t !== "auth" || !msg.id || !msg.key || !msg.secret || idOf(msg.key) !== msg.id) return ws.close(4401, "bad auth");
          const hash = createHash("sha256").update(msg.secret).digest("hex");
          const known = secrets.get(msg.id);
          if (known && known !== hash) return ws.close(4401, "this machine id belongs to another secret");
          secrets.set(msg.id, hash);
          servers.get(msg.id)?.close(4409, "replaced");
          id = msg.id;
          servers.set(id, ws);
          return ws.send(JSON.stringify({ t: "ok" }));
        }
        if (msg.t === "ping") return ws.send(JSON.stringify({ t: "pong" }));
        const client = msg.c ? clients.get(msg.c) : undefined;
        if (!client || client.id !== id) return;
        if (msg.t === "msg" && typeof msg.d === "string") client.ws.send(msg.d);
        else if (msg.t === "close") client.ws.close(4400, msg.reason ?? "closed by the machine");
      });
      ws.onClose(() => {
        if (servers.get(id) !== ws) return;
        servers.delete(id);
        for (const [c, cl] of clients) if (cl.id === id) {
          cl.ws.close(4404, "the machine left the relay");
          clients.delete(c);
        }
      });
      return;
    }
    if (url.pathname === "/api/relay/client") {
      const ws = acceptWebSocket(req, socket, head);
      if (!ws) return;
      const id = url.searchParams.get("id") ?? "";
      const daemon = servers.get(id);
      if (!daemon) return ws.close(4404, "the machine is not connected to the relay");
      const c = randomBytes(8).toString("hex");
      clients.set(c, { id, ws });
      daemon.send(JSON.stringify({ t: "open", c }));
      ws.onMessage((d) => {
        seen.push(d);
        servers.get(id)?.send(JSON.stringify({ t: "msg", c, d }));
      });
      ws.onClose(() => {
        if (!clients.delete(c)) return;
        servers.get(id)?.send(JSON.stringify({ t: "close", c }));
      });
      return;
    }
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    kick: (id) => servers.get(id)?.close(1012, "relay restart"),
    close: () =>
      new Promise<void>((r) => {
        for (const s of servers.values()) s.close();
        for (const c of clients.values()) c.ws.close();
        server.close(() => r());
        server.closeAllConnections?.();
      }),
  };
}
