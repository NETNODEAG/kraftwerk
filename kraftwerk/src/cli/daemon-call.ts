import { resolveWorkspace, workspaceSlug } from "../config.js";
import { findDaemon } from "../core/daemon.js";

/**
 * A route of this folder's workspace on the running daemon — what the CLI
 * uses for what only the daemon does (cloud boards, the workspace's cloud
 * mode). `open`: a workspace the daemon does not serve yet is opened there
 * first (else that is an error). Throws an Error with the daemon's message.
 */
export async function workspaceCall<T>(method: string, route: string, body?: unknown, opts: { open?: boolean } = {}): Promise<T> {
  const ws = await resolveWorkspace(process.cwd());
  const daemon = await findDaemon();
  if (!daemon) throw new Error("this goes through the daemon, and it is not running — `kraftwerk daemon start`");
  const base = `http://127.0.0.1:${daemon.port}`;
  const send = (url: string, m: string, b?: unknown) =>
    fetch(url, {
      method: m,
      headers: b !== undefined ? { "content-type": "application/json" } : {},
      body: b !== undefined ? JSON.stringify(b) : undefined,
      signal: AbortSignal.timeout(20_000),
    }).catch((err: Error) => {
      throw new Error(`the daemon did not answer: ${err.message}`);
    });
  const read = async (r: Response) => (await r.json().catch(() => ({}))) as T & { error?: string };
  const url = `${base}/w/${encodeURIComponent(workspaceSlug(ws))}${route}`;
  let r = await send(url, method, body);
  // Not served there yet: open it (its slug may differ from the folder's), then ask again.
  if (r.status === 404 && opts.open) {
    const o = await send(`${base}/api/hub/open`, "POST", { root: ws.root });
    const opened = (await read(o)) as { slug?: string; error?: string };
    if (!o.ok || !opened.slug) throw new Error(opened.error ?? `${o.status} from the daemon`);
    r = await send(`${base}/w/${encodeURIComponent(opened.slug)}${route}`, method, body);
  }
  const data = await read(r);
  if (!r.ok) throw new Error(data.error ?? `${r.status} from the daemon`);
  return data;
}
