import { spawnSync } from "node:child_process";
import { existsSync, promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import type { ResolvedWorkspace } from "../config.js";
import { discoverInstances, legacyWorkspacesDir, tildify } from "../core/instances.js";

/**
 * `kraftwerk doctor`'s legacy section: what older kraftwerk versions left
 * behind that this one still copes with, and what is running or installed
 * at an older version than this CLI. Every check only reads — doctor never
 * changes anything — so each finding says what to do about it.
 */

export interface Finding {
  level: "ok" | "warn" | "info";
  label: string;
  detail?: string;
}

/** True if a < b for plain x.y.z versions (prerelease tags ignored). */
export function versionLt(a: string, b: string): boolean {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

/** Running servers on an older version than this CLI: no socket, no workspace* meta, until relaunched. */
async function olderInstances(version: string): Promise<Finding[]> {
  const old = (await discoverInstances({ fresh: true, readOnly: true })).filter((i) => i.version && versionLt(i.version, version));
  return old.map((i) => ({
    level: "warn" as const,
    label: `${i.name} runs kraftwerk ${i.version}`,
    detail: `${i.url}${i.root ? ` (${tildify(i.root)})` : ""} — relaunch it to run ${version}: the inspector offers it, or restart \`kraftwerk ui\``,
  }));
}

/** Every `kraftwerk` on PATH with its version: two installs at different versions mean the one you run depends on PATH order. */
function installsOnPath(): Finding[] {
  const which = process.platform === "win32" ? spawnSync("where", ["kraftwerk"], { encoding: "utf8" }) : spawnSync("which", ["-a", "kraftwerk"], { encoding: "utf8" });
  if (which.status !== 0) return [];
  const seen = new Map<string, string>();
  for (const bin of which.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    let real = bin;
    try {
      real = realpathSync(bin);
    } catch {}
    if (seen.has(real)) continue;
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15_000 });
    seen.set(real, r.status === 0 ? r.stdout.trim().split("\n")[0] : "?");
  }
  const versions = new Set(seen.values());
  if (seen.size < 2 || versions.size < 2) return [];
  return [
    {
      level: "warn",
      label: `${seen.size} kraftwerk installs on PATH at different versions`,
      detail: [...seen].map(([bin, v]) => `${tildify(bin)} ${v}`).join(", ") + " — the first one wins; update or remove the others",
    },
  ];
}

/** ~/.kraftwerk/projects: where the workspace registry lived until 0.48. Its records were copied over on first use. */
async function oldRegistry(): Promise<Finding[]> {
  const dir = legacyWorkspacesDir();
  const files = await fs.readdir(dir).catch(() => null);
  if (!files) return [];
  return [{ level: "info", label: `old workspace registry at ${tildify(dir)}`, detail: `${files.length} file(s), copied to ~/.kraftwerk/workspaces since 0.49 — safe to delete` }];
}

/** Chats saved before 0.36 scope agent sessions as {kind: "team", member}: read fine, rewritten when next saved. */
async function oldChatScopes(outputDir: string): Promise<Finding[]> {
  const chats = path.join(outputDir, "chats");
  const ids = await fs.readdir(chats).catch(() => [] as string[]);
  let count = 0;
  await Promise.all(
    ids.map(async (id) => {
      try {
        const meta = JSON.parse(await fs.readFile(path.join(chats, id, "meta.json"), "utf8")) as { scope?: { kind?: string } };
        if (meta.scope?.kind === "team") count++;
      } catch {}
    }),
  );
  return count ? [{ level: "info", label: `${count} chat(s) in the pre-0.36 format`, detail: "agent sessions saved as {kind: \"team\"} — they load as before and are rewritten when next saved" }] : [];
}

/** Workflow runs from before runs/ existed sit at the output root as run-*. */
async function oldRunFolders(outputDir: string): Promise<Finding[]> {
  const old = (await fs.readdir(outputDir).catch(() => [] as string[])).filter((e) => e.startsWith("run-"));
  return old.length
    ? [{ level: "info", label: `${old.length} run(s) in the old location`, detail: `${tildify(outputDir)}/run-* — still listed; new runs go to runs/, move them there to tidy up` }]
    : [];
}

/** kraftwerk.yml keys from the Cloudflare Tunnel (removed in 0.65): the loader ignores them (`legacyKeys`). */
function oldConfigKeys(ws: ResolvedWorkspace): Finding[] {
  const keys = ws.legacyKeys ?? [];
  return keys.length
    ? [{ level: "info", label: "kraftwerk.yml still has public:/tunnel:", detail: `${keys.map((k) => `${k}:`).join(", ")} — the Cloudflare Tunnel was removed in 0.65 and these keys are ignored; delete them` }]
    : [];
}

export async function legacyFindings(ws: ResolvedWorkspace, version: string): Promise<Finding[]> {
  const output = existsSync(ws.outputDir) ? ws.outputDir : "";
  const found = [
    ...(await olderInstances(version)),
    ...installsOnPath(),
    ...(await oldRegistry()),
    ...oldConfigKeys(ws),
    ...(output ? await oldChatScopes(output) : []),
    ...(output ? await oldRunFolders(output) : []),
  ];
  return found.length ? found : [{ level: "ok", label: "no legacy leftovers", detail: "no older servers, installs, registry, config keys or data formats" }];
}
