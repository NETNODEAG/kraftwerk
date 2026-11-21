import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspace } from "../config.js";
import { cloudPost, envCloudOff, readCloudFile, writeCloudFile } from "../core/cloud.js";
import { git, NET_TIMEOUT, remoteAuthEnv } from "../core/git.js";
import { ApiError } from "./api/router.js";
import { applyMachineCloud, cloudStatus, machineLink, syncMachineCloud } from "./cloud.js";
import { currentHub } from "./hub-context.js";
import { issueHandoff } from "./users.js";

/**
 * `kraftwerk join <link>` on the daemon's side — start on the platform: a
 * workspace made (or an invite accepted) on kraftwerk cloud comes onto this
 * machine in one go.
 *
 *   1. the machine's cloud on, at the link's origin (a machine already linked
 *      to an account on another cloud is refused)
 *   2. the machine presents the code with its key (POST /api/machines/join);
 *      the cloud claims it for the code's account and names the workspace
 *   3. the workspace cloned from kraftwerk sync into the folder — the machine's
 *      key goes along through core/git.ts setRemoteAuth, nothing is stored;
 *      a cloud repository with no history yet is refused with what to do (its
 *      owner sets up kraftwerk sync first), nothing is made locally
 *   4. the folder opened in the daemon, and a one-time sign-in link for the
 *      browser the CLI opens (no second round through the cloud)
 *
 * Again on a folder that already holds the workspace: no clone, just open.
 */

export interface JoinResult {
  workspace: { id: string; name: string; slug: string; url: string };
  /** Opens the workspace signed in as the account (one use, five minutes); absent when the cloud did not confirm. */
  signin?: string;
  root: string;
  role: string;
  account: string;
  cloned: boolean;
}

/** `<origin>/join/<code>` or a bare code (this machine's cloud). */
export function parseJoinLink(raw: string): { origin: string | null; code: string } {
  const text = raw.trim();
  const m = /^(https?:\/\/[^/]+)\/join\/([^/?#]+)/i.exec(text);
  if (m) return { origin: m[1].replace(/\/+$/, ""), code: decodeURIComponent(m[2]) };
  if (/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(text)) return { origin: null, code: text };
  throw new ApiError(400, "that is not a join link — it looks like https://…/join/XKQ7-2MPD-HH3A");
}

const folderName = (name: string): string =>
  name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";

async function until<T>(fn: () => Promise<T | null>, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** The machine connected to `origin` (its cloud turned on and pointed there when it is free to). */
async function connectTo(origin: string | null): Promise<string> {
  if (currentHub().daemon !== true) throw new ApiError(409, "only the kraftwerk daemon joins workspaces — `kraftwerk daemon start`");
  if (envCloudOff()) throw new ApiError(409, "the cloud is turned off by KRAFTWERK_CLOUD_URL=off");
  const st = cloudStatus();
  if (origin && st.url && st.url !== origin) {
    if (st.state === "connected" && st.account) {
      throw new ApiError(409, `this machine is linked to ${st.url} (as ${st.account}) — the link is for ${origin}; \`kraftwerk cloud disconnect\` first to move it`);
    }
    if (st.source === "env") throw new ApiError(409, `KRAFTWERK_CLOUD_URL points this machine at ${st.url}, the link is for ${origin}`);
  }
  const file = await readCloudFile();
  if (file.enabled === false || (origin && st.url !== origin)) {
    await writeCloudFile({ enabled: true, ...(origin ? { url: origin } : {}) });
    await applyMachineCloud();
  }
  const up = await until(async () => {
    const s = await syncMachineCloud().catch(() => cloudStatus());
    return s.state === "connected" ? s : null;
  }, 20_000);
  if (!up) {
    const s = cloudStatus();
    throw new ApiError(502, `kraftwerk cloud did not answer${s.error ? `: ${s.error}` : ""}`);
  }
  return up.url;
}

export async function joinWorkspace(link: string, dirIn: string | undefined, cwd: string): Promise<JoinResult> {
  const { origin, code } = parseJoinLink(link);
  const url = await connectTo(origin);
  const machine = machineLink();
  if (!machine) throw new ApiError(502, "this machine has no place in the cloud yet");
  const joined = await cloudPost<{ workspaceId: string; workspaceName: string; role: string; account: string; sync?: { url: string } }>(
    url,
    "/api/machines/join",
    { id: machine.creds.id, secret: machine.creds.secret, code },
    { version: machine.version },
  ).catch((err: Error & { status?: number }) => {
    throw new ApiError(err.status && err.status >= 400 && err.status < 500 ? err.status : 502, err.message);
  });
  // The claim shows in the next round; get it now, so git and sign-in see the account.
  await syncMachineCloud().catch(() => {});
  if (!joined.sync) throw new ApiError(502, "this kraftwerk cloud keeps no repositories (kraftwerk sync is off there)");

  const root = path.resolve(cwd, dirIn ?? folderName(joined.workspaceName));
  let cloned = false;
  const here = existsSync(root) ? await resolveWorkspace(root).catch(() => null) : null;
  if (here?.configPath && path.dirname(here.configPath) === root && here.config.id === joined.workspaceId) {
    // Already here: open it.
  } else if (existsSync(root) && (await fs.readdir(root)).length > 0) {
    throw new ApiError(409, `${root} exists and is not empty — pass another folder: kraftwerk join <link> <folder>`);
  } else {
    // A workspace whose repository has no history yet (begun locally, kraftwerk sync not set up there yet):
    // nothing to clone — a kraftwerk.yml made here would collide with the owner's first push.
    const heads = await git(["ls-remote", "--heads", "--", joined.sync.url], cwd, NET_TIMEOUT, remoteAuthEnv());
    if (!heads.ok) throw new ApiError(502, `kraftwerk sync did not answer: ${heads.stderr || "unknown error"}`);
    if (!heads.stdout.trim()) {
      throw new ApiError(
        409,
        `${joined.workspaceName} has no files in kraftwerk sync yet — whoever runs it has to set up kraftwerk sync first (kraftwerk → Git → "set up kraftwerk sync"); then run this again. This machine is linked to ${joined.account} already.`,
      );
    }
    await fs.mkdir(path.dirname(root), { recursive: true });
    const r = await git(["clone", "-q", "--", joined.sync.url, root], path.dirname(root), NET_TIMEOUT * 5, remoteAuthEnv());
    if (!r.ok) throw new ApiError(502, `cloning from kraftwerk sync failed: ${r.stderr || "unknown error"}`);
    cloned = true;
  }
  const o = await currentHub().open(root);
  // The cloud learns the workspace is here now (its host list, sign-in).
  await syncMachineCloud().catch(() => {});
  // Signed in at once: the link proved the account (server/users.ts issueHandoff).
  const accountId = cloudStatus().accountId;
  const token = accountId ? await issueHandoff(joined.workspaceId, accountId) : null;
  return {
    workspace: { id: joined.workspaceId, name: joined.workspaceName, slug: o.slug, url: o.url },
    ...(token ? { signin: `${o.url}/auth/handoff?t=${token}` } : {}),
    root,
    role: joined.role,
    account: joined.account,
    cloned,
  };
}
