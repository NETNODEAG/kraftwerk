import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local stand-in for the kraftwerk cloud's machine API (the contract in
 * src/core/cloud.ts): register / heartbeat / goodbye / unlink, with the
 * cloud's rules — the first register claims the id, later calls must
 * present the same secret (403 otherwise), an unknown id is a 404, a claim
 * made "in the web UI" (`claim`) arrives in the next heartbeat answer.
 * Every call is recorded in `hits`.
 */
export interface Hit {
  path: string;
  body: Record<string, unknown>;
  at: number;
}

export interface StubMachine {
  secret: string;
  account: string | null;
  claimCode: string | null;
  workspaces: unknown[];
  online: boolean;
}

export interface StubCloud {
  url: string;
  hits: Hit[];
  machines: Map<string, StubMachine>;
  /** Claim a machine into an account, as the web UI would. */
  claim(id: string, email: string): void;
  /** Forget a machine (a data reset): its next heartbeat gets a 404. */
  forget(id: string): void;
  /** Calls to one endpoint (register, heartbeat, goodbye, unlink). */
  calls(name: string): Hit[];
  close(): Promise<void>;
}

let codes = 0;
const nextCode = (): string => `CODE-${String(++codes).padStart(4, "0")}`;

export async function startStubCloud(opts: { interval?: number; onHeartbeat?: (id: string, cloud: StubCloud) => void } = {}): Promise<StubCloud> {
  const interval = opts.interval ?? 1;
  const hits: Hit[] = [];
  const machines = new Map<string, StubMachine>();
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      const body = JSON.parse(text || "{}") as Record<string, unknown>;
      const p = req.url ?? "";
      hits.push({ path: p, body, at: Date.now() });
      const id = String(body.id ?? "");
      const m = machines.get(id);
      if (p === "/api/machines/register") {
        if (m && m.secret !== body.secret) return send(res, 403, { error: "wrong machine secret" });
        const rec = m ?? { secret: String(body.secret), account: null, claimCode: nextCode(), workspaces: [], online: true };
        rec.workspaces = (body.workspaces as unknown[]) ?? [];
        rec.online = true;
        machines.set(id, rec);
        return send(res, 200, { ok: true, interval, claimCode: rec.claimCode, account: rec.account });
      }
      if (!m) return send(res, 404, { error: "unknown machine" });
      if (m.secret !== body.secret) return send(res, 403, { error: "wrong machine secret" });
      if (p === "/api/machines/heartbeat") {
        opts.onHeartbeat?.(id, stub);
        if (body.workspaces) m.workspaces = body.workspaces as unknown[];
        m.online = true;
        return send(res, 200, { ok: true, interval, account: m.account, claimCode: m.claimCode });
      }
      if (p === "/api/machines/goodbye") {
        m.online = false;
        return send(res, 200, { ok: true });
      }
      if (p === "/api/machines/unlink") {
        m.account = null;
        m.claimCode = nextCode();
        return send(res, 200, { ok: true, claimCode: m.claimCode });
      }
      send(res, 404, { error: "no such route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const stub: StubCloud = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    machines,
    claim(id, email) {
      const m = machines.get(id);
      if (!m) throw new Error(`no machine ${id}`);
      m.account = email;
      m.claimCode = null;
    },
    forget(id) {
      machines.delete(id);
    },
    calls: (name) => hits.filter((h) => h.path === `/api/machines/${name}`),
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
  return stub;
}
