import { resolveWorkspace } from "../config.js";
import { readAccountFile } from "../core/cloud.js";
import { workspaceRoot } from "../core/context.js";
import { ApiError } from "./api/router.js";
import { machineLink } from "./cloud.js";
import { personOf } from "./person.js";
import type { Trust } from "./trust.js";

/**
 * Remote boards — a workspace's boards kept in kraftwerk cloud (the cloud's
 * boards.ts), multiplayer, beside the local boards (core/boards.ts, files in
 * the repo, single player). They never sync with each other.
 *
 * The daemon is the way there from this machine's UI, CLI and agents: it
 * calls the cloud with the machine's id + secret and says who it acts for —
 *
 *   a browser signed in with its cloud account (users: cloud)  → that person
 *   everyone else on this machine (its shell, a paired device,
 *   a users: local workspace)                                  → the account that claimed the machine
 *   a remote member through the relay                          → refused: they use the cloud's own UI
 *
 * — and an agent or process naming itself (`actor`) is passed on as such;
 * the cloud never takes a human actor from a machine. The cloud allows a
 * machine to act only for its account and the people who signed in to it.
 *
 * Offline is offline: no cache. With the machine not connected (cloud off,
 * not claimed, the workspace without a ws_ id) or the cloud not answering,
 * calls fail 503 with `offline: true` and the UI marks remote boards offline.
 */

export interface RemoteCall {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** After /api/workspaces/<ws>/, e.g. "boards/launch/tasks/3". */
  path: string;
  body?: unknown;
  /** An agent or process naming itself (lisa/claude, process:sync); a human actor is ignored. */
  actor?: string;
}

const REMOTE_TIMEOUT_MS = 10_000;
/** Reads wait less: the boards list asks on every poll. */
const READ_TIMEOUT_MS = 4_000;
/** After the cloud did not answer, calls fail at once for this long instead of each waiting out a timeout. */
const DOWN_FOR_MS = 15_000;
let down: { until: number; why: string } | null = null;

const offline = (why: string): ApiError => new ApiError(503, why, { error: why, offline: true });

/** The ws_ id of the workspace this request is in; 409 without one (`kraftwerk doctor --fix` writes it). */
export async function remoteWorkspaceId(): Promise<string> {
  const ws = await resolveWorkspace(workspaceRoot());
  const id = ws.config.id;
  if (!id) throw new ApiError(409, "this workspace has no id yet — `kraftwerk doctor --fix` gives it one", { error: "this workspace has no id yet — `kraftwerk doctor --fix` gives it one", offline: true });
  return id;
}

export async function remoteCall<T>(trust: Trust, call: RemoteCall): Promise<T> {
  if (trust.kind === "member") throw new ApiError(403, "remote boards are in kraftwerk cloud — open them there");
  const link = machineLink();
  if (!link) throw offline("kraftwerk cloud is off or not connected on this machine");
  const wsId = await remoteWorkspaceId();
  const [person, account] = await Promise.all([personOf(trust), readAccountFile()]);
  if (!account) throw offline("this machine is not claimed by a cloud account — `kraftwerk login`");
  const as = person.id && person.id !== account.id ? person.id : undefined;
  const actor = call.actor && !call.actor.trim().startsWith("human:") ? call.actor.trim() : undefined;
  if (down && down.until > Date.now()) throw offline(down.why);
  let r: Response;
  try {
    r = await fetch(`${link.url}/api/workspaces/${encodeURIComponent(wsId)}/${call.path}`, {
      method: call.method,
      headers: {
        "user-agent": `kraftwerk/${link.version}`,
        "x-kw-machine-id": link.creds.id,
        "x-kw-machine-secret": link.creds.secret,
        ...(as ? { "x-kw-user": as } : {}),
        ...(actor ? { "x-kw-actor": actor } : {}),
        ...(call.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: call.body !== undefined ? JSON.stringify(call.body) : undefined,
      signal: AbortSignal.timeout(call.method === "GET" ? READ_TIMEOUT_MS : REMOTE_TIMEOUT_MS),
    });
  } catch (err) {
    const why = `kraftwerk cloud does not answer (${(err as Error).message})`;
    down = { until: Date.now() + DOWN_FOR_MS, why };
    throw offline(why);
  }
  down = null;
  const text = await r.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw offline(`kraftwerk cloud answered ${r.status}, not JSON`);
  }
  if (r.status >= 500) throw offline(String(data.error ?? `kraftwerk cloud answered ${r.status}`));
  if (!r.ok) {
    const error = String(data.error ?? `kraftwerk cloud answered ${r.status}`);
    // A person who signed in before the cloud kept sign-ins must sign in once more.
    const signin = r.status === 403 && /may act only for/.test(error) && as ? { signin: true } : {};
    throw new ApiError(r.status, error, { error, ...signin });
  }
  return data as T;
}

/** The cloud's address for this workspace's page, for "open in cloud" links. */
/** Forget that the cloud was down (tests; `kraftwerk cloud sync`). */
export const resetRemoteDown = (): void => {
  down = null;
};

export async function remoteWorkspaceUrl(): Promise<string | null> {
  const link = machineLink();
  if (!link) return null;
  const ws = await resolveWorkspace(workspaceRoot()).catch(() => null);
  return ws?.config.id ? `${link.url}/w/${encodeURIComponent(ws.config.id)}` : null;
}
