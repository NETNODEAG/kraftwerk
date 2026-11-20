import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local stand-in for the kraftwerk cloud's machine API (the contract in
 * src/core/cloud.ts): register / heartbeat / goodbye / unlink, with the
 * cloud's rules — the first register claims the id, later calls must
 * present the same secret (403 otherwise), an unknown id is a 404, a claim
 * made "in the web UI" (`claim`) arrives in the next heartbeat answer.
 * Every call is recorded in `hits`.
 *
 * Membership too: `addMember` hands out a member token for a workspace id
 * (`revokeMember` takes it back); /api/members/verify answers 404 for an
 * unknown or revoked token and 403 when the machine does not report the
 * workspace; /api/workspaces/:id/invites gives a claimed machine that
 * reports the workspace an invite. A heartbeat's `routines` are kept on the
 * machine. `down` makes the cloud unreachable (every connection dropped).
 *
 * Signing in (users: cloud): `authorize` is what the cloud's /signin page
 * does for a signed-in account — a one-time code for a machine, workspace
 * and redirect; /api/signin/exchange redeems it once (with the machine's
 * secret), /api/signin/verify re-checks a person; `people` holds who is on
 * which workspace (delete a row to remove someone). A claimed machine's
 * answers carry its account's uuid and handle (`accounts`).
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
  /** The last routines a heartbeat carried. */
  routines?: unknown[];
}

export interface StubMember {
  email: string;
  handle: string;
  role: "owner" | "member";
}

export interface StubPerson {
  id: string;
  email: string;
  handle: string;
}

export interface StubCloud {
  url: string;
  /** Accounts by email: the uuid and handle a claim or sign-in names. */
  accounts: Map<string, StubPerson>;
  /** "<ws id> <email>" → role: who may sign in to which workspace. */
  people: Map<string, "owner" | "member">;
  /** The cloud's /signin page, confirmed by `email`: the redirect back to the machine with ?code&state. */
  authorize(email: string, q: { workspace: string; machine: string; redirect: string; state: string }): string;
  hits: Hit[];
  machines: Map<string, StubMachine>;
  /** Claim a machine into an account, as the web UI would. */
  claim(id: string, email: string): void;
  /** Forget a machine (a data reset): its next heartbeat gets a 404. */
  forget(id: string): void;
  /** Calls to one endpoint (register, heartbeat, goodbye, unlink). */
  calls(name: string): Hit[];
  /** A member of workspace `workspaceId`: their kwm_ token. */
  addMember(workspaceId: string, member: StubMember): string;
  revokeMember(token: string): void;
  /** Calls to /api/members/verify. */
  verifies(): Hit[];
  /** Calls to /api/workspaces/:id/invites. */
  invites(): Hit[];
  /** Unreachable: every connection is dropped while true. */
  down: boolean;
  close(): Promise<void>;
}

let codes = 0;
const nextCode = (): string => `CODE-${String(++codes).padStart(4, "0")}`;

export async function startStubCloud(opts: { interval?: number; onHeartbeat?: (id: string, cloud: StubCloud) => void } = {}): Promise<StubCloud> {
  const interval = opts.interval ?? 1;
  const hits: Hit[] = [];
  const machines = new Map<string, StubMachine>();
  const members = new Map<string, StubMember & { workspaceId: string }>();
  const accounts = new Map<string, StubPerson>();
  const people = new Map<string, "owner" | "member">();
  const codes = new Map<string, { email: string; workspace: string; machine: string; redirect: string; used: boolean }>();
  const account = (email: string): StubPerson => {
    let a = accounts.get(email);
    if (!a) {
      a = { id: `00000000-0000-4000-8000-${String(accounts.size + 1).padStart(12, "0")}`, email, handle: email.split("@")[0] };
      accounts.set(email, a);
    }
    return a;
  };
  const claimFields = (email: string | null) => (email ? { accountId: account(email).id, accountHandle: account(email).handle } : { accountId: null, accountHandle: null });
  let inviteN = 0;
  const reports = (mach: StubMachine, workspaceId: string) => mach.workspaces.some((w) => (w as { id?: string }).id === workspaceId);
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    if (stub.down) return void req.socket.destroy();
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
        return send(res, 200, { ok: true, interval, claimCode: rec.claimCode, account: rec.account, ...claimFields(rec.account) });
      }
      if (!m) return send(res, 404, { error: "unknown machine" });
      if (m.secret !== body.secret) return send(res, 403, { error: "wrong machine secret" });
      if (p === "/api/machines/heartbeat") {
        opts.onHeartbeat?.(id, stub);
        if (body.workspaces) m.workspaces = body.workspaces as unknown[];
        if (body.routines) m.routines = body.routines as unknown[];
        m.online = true;
        return send(res, 200, { ok: true, interval, account: m.account, ...claimFields(m.account), claimCode: m.claimCode });
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
      if (p === "/api/members/verify") {
        const wsId = String(body.workspaceId ?? "");
        if (!reports(m, wsId)) return send(res, 403, { error: "this machine does not host that workspace" });
        const mem = members.get(String(body.token ?? ""));
        if (!mem || mem.workspaceId !== wsId) return send(res, 404, { error: "unknown member token" });
        return send(res, 200, { email: mem.email, handle: mem.handle, role: mem.role });
      }
      if (p === "/api/signin/exchange") {
        const c = codes.get(String(body.code ?? ""));
        if (!c || c.machine !== id || c.redirect !== body.redirect) return send(res, 404, { error: "unknown sign-in code" });
        if (c.used) return send(res, 410, { error: "this sign-in code was already used" });
        c.used = true;
        const role = people.get(`${c.workspace} ${c.email}`);
        if (!role) return send(res, 403, { error: "no longer a member" });
        return send(res, 200, { user: account(c.email), workspaceId: c.workspace, role });
      }
      if (p === "/api/signin/verify") {
        const who = [...accounts.values()].find((a) => a.id === body.user);
        const role = who && people.get(`${String(body.workspace)} ${who.email}`);
        if (!who || !role) return send(res, 404, { error: "not a member of that workspace" });
        return send(res, 200, { user: who, role });
      }
      const inv = /^\/api\/workspaces\/([^/]+)\/invites$/.exec(p);
      if (inv) {
        const wsId = decodeURIComponent(inv[1]);
        if (!m.account) return send(res, 403, { error: "the machine is not claimed" });
        if (!reports(m, wsId)) return send(res, 403, { error: "this machine does not report that workspace" });
        const code = `JOIN-${String(++inviteN).padStart(4, "0")}`;
        const role = body.role === "owner" ? "owner" : "member";
        return send(res, 200, { code, url: `${stub.url}/join/${code}`, role, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
      }
      send(res, 404, { error: "no such route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const stub: StubCloud = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    machines,
    accounts,
    people,
    authorize(email, q) {
      if (!people.get(`${q.workspace} ${email}`)) throw new Error(`${email} is not on ${q.workspace}`);
      const code = randomBytes(16).toString("hex");
      codes.set(code, { email, workspace: q.workspace, machine: q.machine, redirect: q.redirect, used: false });
      const back = new URL(q.redirect);
      back.searchParams.set("code", code);
      back.searchParams.set("state", q.state);
      return back.href;
    },
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
    addMember(workspaceId, member) {
      const token = `kwm_${randomBytes(16).toString("hex")}`;
      members.set(token, { ...member, workspaceId });
      return token;
    },
    revokeMember(token) {
      members.delete(token);
    },
    verifies: () => hits.filter((h) => h.path === "/api/members/verify"),
    invites: () => hits.filter((h) => /^\/api\/workspaces\/[^/]+\/invites$/.test(h.path)),
    down: false,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
  return stub;
}
