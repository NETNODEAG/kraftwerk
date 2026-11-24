import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessId } from "../harness.js";
import type { AuthStatus } from "./chat/types.js";
import { workspaceEnv } from "./env.js";
import { CREDENTIAL_KINDS, credentialOf, type CredentialInfo, type CredentialKind } from "./harness-credentials.js";
import { currentWorkspace } from "./workspace.js";

/**
 * The harnesses this machine can run agents on, and what each would sign
 * in with — the settings' answer to "why does the agent say it is not
 * logged in" (web: #/settings/harnesses). Read from what is on disk and in
 * the environment; no agent is started for it.
 *
 *   runs       how it can be driven here: the adapter bundled with kraftwerk
 *              (chats, `protocol: acp`), its CLI on the PATH (`protocol: cli`)
 *   credential what was entered in the settings (harness-credentials.ts)
 *   env        a variable the harness reads that is set in the shell or the
 *              workspace's .env — the name only
 *   login      the CLI's own login on this machine: its credentials file is
 *              there, is not, or cannot be told (macOS keeps Claude's in the keychain)
 *   seen       who the agent said it is, the last time a chat on it started here
 */

const ADAPTERS: Partial<Record<HarnessId, string>> = {
  claude: "@agentclientprotocol/claude-agent-acp",
  codex: "@agentclientprotocol/codex-acp",
};
const CLI: Record<HarnessId, string> = { claude: "claude", codex: "codex", pi: "pi", antigravity: "agy" };
const LABEL: Record<HarnessId, string> = { claude: "Claude Code", codex: "Codex", pi: "pi", antigravity: "Antigravity" };
/** The CLI's own credentials file under HOME, where it keeps one. */
const LOGIN_FILE: Partial<Record<HarnessId, string[]>> = {
  claude: [".claude", ".credentials.json"],
  codex: [".codex", "auth.json"],
};

export interface HarnessStatus {
  id: HarnessId;
  label: string;
  /** Usable here at all: an adapter or a CLI is there. */
  available: boolean;
  adapter?: { version: string };
  cli?: { command: string; path: string };
  /** The CLI it needs when neither is there, to say what to install. */
  needs?: string;
  /** The kinds the settings can store for it. */
  accepts: Array<{ kind: CredentialKind; label: string; hint: string }>;
  credential?: CredentialInfo;
  /** Names of variables set outside the settings (shell, .env) that it would read. */
  env: string[];
  login: "present" | "absent" | "unknown";
  seen?: AuthStatus & { at: number };
}

function adapterVersion(pkg: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(`${pkg}/package.json`)), "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

function onPath(command: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, command);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      /* not here */
    }
  }
  return undefined;
}

/** Who each harness last said it is, per workspace folder (this process only). */
const seen = new Map<string, AuthStatus & { at: number }>();
const seenKey = (root: string, id: string): string => `${root}\n${id}`;

/** A chat's agent reported who it is signed in as (chat/acp.ts): remembered for the settings. */
export function noteHarnessAuth(id: string, auth: AuthStatus): void {
  try {
    seen.set(seenKey(currentWorkspace().root, id), { ...auth, at: Date.now() });
  } catch {
    /* outside a workspace: nobody to tell */
  }
}

/** Forget what a harness last said: its credential changed, so the next chat says anew. */
export function forgetHarnessAuth(root: string, id: HarnessId): void {
  seen.delete(seenKey(root, id));
}

/** Every harness, for the current workspace. */
export function harnessStatuses(): HarnessStatus[] {
  const ws = currentWorkspace();
  const env = workspaceEnv();
  const home = os.homedir();
  return (Object.keys(CLI) as HarnessId[]).map((id) => {
    const version = ADAPTERS[id] ? adapterVersion(ADAPTERS[id]!) : undefined;
    const cliPath = onPath(CLI[id], env);
    const kinds = CREDENTIAL_KINDS[id];
    const credential = credentialOf(ws.root, id);
    // What the shell or the .env brings by itself — not what the settings put there.
    const outside = (name: string): boolean => !!(process.env[name] || ws.env[name]);
    const loginFile = LOGIN_FILE[id];
    const login: HarnessStatus["login"] = !loginFile
      ? "unknown"
      : existsSync(path.join(home, ...loginFile))
        ? "present"
        : id === "claude" && process.platform === "darwin"
          ? "unknown"
          : "absent";
    const last = seen.get(seenKey(ws.root, id));
    return {
      id,
      label: LABEL[id],
      available: !!version || !!cliPath,
      ...(version ? { adapter: { version } } : {}),
      ...(cliPath ? { cli: { command: CLI[id], path: cliPath } } : {}),
      ...(!version && !cliPath ? { needs: CLI[id] } : {}),
      accepts: (Object.entries(kinds) as Array<[CredentialKind, { label: string; hint: string }]>).map(([kind, k]) => ({ kind, label: k.label, hint: k.hint })),
      ...(credential ? { credential } : {}),
      env: [...new Set(Object.values(kinds).flatMap((k) => k.env))].filter(outside),
      login,
      ...(last ? { seen: last } : {}),
    };
  });
}
