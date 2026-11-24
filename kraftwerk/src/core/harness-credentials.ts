import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HarnessId } from "../harness.js";

/**
 * What a harness signs in with, when it is not the CLI login of whoever
 * runs this machine: an API key, or a subscription's long-lived token.
 * Entered in the settings (web: #/settings/harnesses), kept on this machine
 * in ~/.kraftwerk/harness-credentials.json (0600) — never in the workspace
 * folder, so kraftwerk sync cannot carry it to the others — and handed to
 * everything the workspace spawns as the environment variable the harness
 * reads (core/env.ts).
 *
 *   scope    "workspace": this workspace on this machine (its folder);
 *            "machine": every workspace here that has none of its own
 *   kind     api_key | subscription_token — one per harness and scope; the
 *            other kind's variables are taken out of the environment, so
 *            what was chosen here is what the harness uses
 *
 * A value is written and never read back by anyone but the spawn: the API
 * shows which kind is set, where, since when, and its last four characters.
 */

export type CredentialKind = "api_key" | "subscription_token";
export type CredentialScope = "workspace" | "machine";

interface KindSpec {
  /** The variables the harness reads it from. */
  env: string[];
  label: string;
  /** Where the value comes from, for the form. */
  hint: string;
}

/** What each harness can be given. A harness without an entry signs in with its own CLI only. */
export const CREDENTIAL_KINDS: Record<HarnessId, Partial<Record<CredentialKind, KindSpec>>> = {
  claude: {
    api_key: { env: ["ANTHROPIC_API_KEY"], label: "API key", hint: "An Anthropic API key (console.anthropic.com), billed per use." },
    subscription_token: { env: ["CLAUDE_CODE_OAUTH_TOKEN"], label: "subscription token", hint: "A long-lived token of a Claude subscription: run `claude setup-token` on a machine that is logged in." },
  },
  codex: {
    api_key: { env: ["OPENAI_API_KEY", "CODEX_API_KEY"], label: "API key", hint: "An OpenAI API key (platform.openai.com), billed per use." },
  },
  pi: {},
  antigravity: {},
};

/** Variables that would override a chosen kind, per harness: out of the environment once a credential is set. */
const OTHER_VARS: Partial<Record<HarnessId, string[]>> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
};

interface Stored {
  kind: CredentialKind;
  value: string;
  setAt: number;
}
interface Store {
  version: 1;
  /** "machine", or "ws:<absolute workspace folder>". */
  scopes: Record<string, Partial<Record<HarnessId, Stored>>>;
}

/** A stored credential as the API shows it: never the value. */
export interface CredentialInfo {
  scope: CredentialScope;
  kind: CredentialKind;
  /** Its last four characters. */
  ending: string;
  setAt: number;
}

const storeFile = (): string => path.join(os.homedir(), ".kraftwerk", "harness-credentials.json");
const scopeKey = (scope: CredentialScope, root: string): string => (scope === "machine" ? "machine" : `ws:${path.resolve(root)}`);

let cache: { file: string; mtimeMs: number; store: Store } | undefined;

function read(): Store {
  const file = storeFile();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return { version: 1, scopes: {} };
  }
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.store;
  let store: Store = { version: 1, scopes: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Store>;
    if (parsed && typeof parsed.scopes === "object" && parsed.scopes) store = { version: 1, scopes: parsed.scopes };
  } catch {
    /* unreadable: as good as empty; the next write replaces it */
  }
  cache = { file, mtimeMs, store };
  return store;
}

function write(store: Store): void {
  const file = storeFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  cache = undefined;
}

/** Set (or replace) what `harness` signs in with, for this workspace or the whole machine. Throws on a kind the harness does not take or a value that cannot be one. */
export function setCredential(root: string, harness: HarnessId, scope: CredentialScope, kind: CredentialKind, value: string): CredentialInfo {
  if (!CREDENTIAL_KINDS[harness]?.[kind]) throw new Error(`${harness} takes no ${kind === "api_key" ? "API key" : "subscription token"} here — it signs in with its own CLI`);
  const v = value.trim();
  if (v.length < 8 || v.length > 4096 || /\s/.test(v)) throw new Error("that does not look like a key: 8 to 4096 characters, no spaces");
  const store = structuredClone(read());
  const key = scopeKey(scope, root);
  const setAt = Date.now();
  store.scopes[key] = { ...store.scopes[key], [harness]: { kind, value: v, setAt } };
  write(store);
  return { scope, kind, ending: v.slice(-4), setAt };
}

/** Forget it; false when there was none in that scope. */
export function removeCredential(root: string, harness: HarnessId, scope: CredentialScope): boolean {
  const store = structuredClone(read());
  const key = scopeKey(scope, root);
  if (!store.scopes[key]?.[harness]) return false;
  delete store.scopes[key]![harness];
  if (Object.keys(store.scopes[key]!).length === 0) delete store.scopes[key];
  write(store);
  return true;
}

function effective(root: string, harness: HarnessId): { scope: CredentialScope; stored: Stored } | undefined {
  const store = read();
  const ws = store.scopes[scopeKey("workspace", root)]?.[harness];
  if (ws) return { scope: "workspace", stored: ws };
  const machine = store.scopes.machine?.[harness];
  return machine ? { scope: "machine", stored: machine } : undefined;
}

/** What `harness` uses in the workspace at `root`: its own, else the machine's; undefined when neither is set. */
export function credentialOf(root: string, harness: HarnessId): CredentialInfo | undefined {
  const e = effective(root, harness);
  return e ? { scope: e.scope, kind: e.stored.kind, ending: e.stored.value.slice(-4), setAt: e.stored.setAt } : undefined;
}

/** Put the workspace's credentials into `env` (in place): each chosen kind's variables set, the harness's other ones gone. */
export function applyCredentials(root: string, env: NodeJS.ProcessEnv): void {
  for (const harness of Object.keys(CREDENTIAL_KINDS) as HarnessId[]) {
    const e = effective(root, harness);
    const spec = e && CREDENTIAL_KINDS[harness][e.stored.kind];
    if (!e || !spec) continue;
    for (const name of OTHER_VARS[harness] ?? []) delete env[name];
    for (const name of spec.env) env[name] = e.stored.value;
  }
}
