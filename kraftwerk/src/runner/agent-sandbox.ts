import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AcpAgent } from "../acp.js";

/**
 * Agent sandbox: one long-lived Docker container per agent, in which that
 * agent's ACP adapter runs instead of on the host.
 *
 * The workflow sandbox (runner/docker.ts) is one container per *run* — it
 * starts, executes `kraftwerk run`, and dies. A chat agent is the other
 * shape: the conversation outlives any single turn, so the container is
 * started once (`sleep infinity`) and every ACP session enters it with
 * `docker exec -i`. The inspector stays the ACP *client* on the host, which
 * is what keeps the transcript and the audit trail out of the agent's reach.
 *
 * The workspace lives at /workspace inside the container, never at its host
 * path — see SANDBOX_ROOT for why — so every path handed to the agent goes
 * through sandboxPath()/redactHostPaths() first.
 *
 * What the admin pins per agent (agent.yml `sandbox:`) is the boundary, not
 * a tool allowlist — which files the agent can reach and how, whether it has
 * a network, which secrets exist in its environment, how much CPU and memory
 * it gets. The harness keeps deciding which individual tool calls need a
 * human; this only decides what those calls can possibly touch.
 */

/**
 * Where the workspace lives *inside* a sandbox.
 *
 * Not the host path. An agent on a share link is someone else's, and a host
 * path tells them the admin's username, the directory layout, and — on a
 * server that holds several customers — how the others are named. It also
 * reads as a leak even when it is only a string, which is its own problem.
 *
 * Everything the agent is handed is translated: its working directory, the
 * mount targets, and the project context in its first prompt. Paths coming
 * back the other way are already container paths, because that is where the
 * agent ran.
 */
export const SANDBOX_ROOT = "/workspace";

/** Only used when the output directory sits outside the project root. */
const SANDBOX_OUTPUT = "/workspace/.output";

export interface HostPaths {
  projectRoot: string;
  outputDir: string;
}

const under = (parent: string, child: string): string | null => {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (c === p) return "";
  return c.startsWith(p + path.sep) ? c.slice(p.length + 1) : null;
};

/** Anchor for the output directory: inside the project root, or its own mount. */
const outputAnchor = (hosts: HostPaths): string => {
  const rel = under(hosts.projectRoot, hosts.outputDir);
  return rel === null ? SANDBOX_OUTPUT : rel === "" ? SANDBOX_ROOT : `${SANDBOX_ROOT}/${rel}`;
};

/**
 * A host path as the sandbox sees it. Anything outside the workspace and the
 * output directory has no place inside the sandbox, so it collapses to the
 * workspace root rather than being passed through half-translated.
 */
export function sandboxPath(hostPath: string, hosts: HostPaths): string {
  const relOut = under(hosts.outputDir, hostPath);
  if (relOut !== null) {
    const anchor = outputAnchor(hosts);
    return relOut === "" ? anchor : `${anchor}/${relOut.split(path.sep).join("/")}`;
  }
  const rel = under(hosts.projectRoot, hostPath);
  if (rel === null) return SANDBOX_ROOT;
  return rel === "" ? SANDBOX_ROOT : `${SANDBOX_ROOT}/${rel.split(path.sep).join("/")}`;
}

/**
 * Rewrite every host path in free text (the project context the agent is
 * given in its first prompt) to its sandbox path. Done on the finished
 * string rather than at each place that builds one: the context is assembled
 * by a dozen builders, and a new one must not be able to leak a path by
 * forgetting to translate.
 */
export function redactHostPaths(text: string, hosts: HostPaths): string {
  const roots = [hosts.outputDir, hosts.projectRoot]
    .map((r) => path.resolve(r))
    // Longest first: an output dir inside the project root has to win.
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const root of roots) {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped + "(?![\\w.-])", "g"), sandboxPath(root, hosts));
  }
  return out;
}

export const AGENT_IMAGE = "kraftwerk-agent";

/** ACP adapter binaries, installed globally in the image (their package `bin` names). */
const ADAPTER_BIN: Record<AcpAgent, string> = {
  claude: "claude-agent-acp",
  codex: "codex-acp",
};

/** Model credentials forwarded from the inspector process when present. */
const PASSTHROUGH_ENV = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

/** Framework package root (contains runner/agent.Dockerfile). */
const frameworkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * What the agent may see of the workspace. The sandbox mounts *only* these —
 * the project root itself is never bind-mounted, so anything not granted is
 * simply not there. The lists are the grants that already exist in agent.yml
 * (`knowledge:`, `workflows:`, `skills:`); this is where they stop being
 * advertisement and start being enforced.
 */
export interface SandboxGrants {
  /** The project's kraftwerk.yml, read-only — `kraftwerk run` needs it to resolve the project. */
  config?: string;
  /** Knowledge root + the bundles this agent may see. Writable: agents maintain their bundles. */
  knowledge?: { root: string; allow: string[] };
  /** Workflow root + the workflows this agent may run. Read-only: definitions are config. */
  workflows?: { root: string; allow: string[] };
  /** Skills root + the skills this agent may load; `allow: null` = the whole root (agent.yml omits `skills:`). */
  skills?: { root: string; allow: string[] | null };
  /**
   * Repository root + the clones this agent may read. Read-only: the clone
   * belongs to the control plane, which keeps it current, so the agent sees
   * the code without a deploy key ever entering the container — and cannot
   * rewrite history under a workspace that other agents share.
   */
  repos?: { root: string; allow: string[] };
  /**
   * Files people attached in this agent's chats, mounted read-only.
   *
   * Its own root, not the chats folder: the transcripts live there too, and
   * an agent that could read those could read every other conversation in
   * the workspace — including other customers'. Read-only because an upload
   * is something a person handed over, not something the agent revises.
   */
  uploads?: { root: string };
}

/** Folder/file names a grant may name (same shape as an OKF bundle name). */
const GRANT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Every field below reaches a `docker` argument, and since the profile is
 * editable over HTTP the shapes are checked here rather than trusted. A
 * value that does not fit falls back to the default instead of being passed
 * through: a malformed memory limit should mean "the default", never "no
 * limit", and a hostname with a comma in it must not become a second
 * option on the proxy's command line.
 */
const IMAGE_RE = /^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?$/;
const MEMORY_RE = /^\d+(\.\d+)?[bkmgBKMG]?$/;
const CPUS_RE = /^\d+(\.\d+)?$/;
/** A hostname, or `*.` plus one. */
const HOST_RE = /^(\*\.)?[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
/** A binary name: no path, no separator the init's comma-split would trip on. */
const COMMAND_RE = /^[A-Za-z0-9._+-]+$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const strOr = (value: unknown, re: RegExp, fallback: string): string => {
  const s = typeof value === "string" ? value.trim() : value != null ? String(value) : "";
  return s && re.test(s) ? s : fallback;
};

const listOf = (value: unknown, re: RegExp): string[] =>
  Array.isArray(value)
    ? value.map((v) => String(v).trim()).filter((v) => re.test(v))
    : [];

export interface SandboxProfile {
  /** false keeps the block but runs the agent on the host, as before. */
  enabled: boolean;
  image: string;
  /**
   * "open": ordinary bridge networking. "none": no network at all.
   * "allowlist": the agent joins a Docker network with no route out, and
   * reaches the internet only through an egress proxy that forwards to
   * `allow` and refuses everything else (see egress-proxy.ts).
   */
  network: "none" | "open" | "allowlist";
  /** `network: allowlist` only — hosts, or `*.example.com` for a domain and its subdomains. */
  allow: string[];
  memory: string;
  cpus: string;
  pids: number;
  /** Extra environment variable names forwarded from the inspector process. */
  env: string[];
  /**
   * Commands the agent may run, by binary name (`ls`, `git`, `curl`).
   * Absent or empty = no restriction, as before.
   *
   * Enforced with file permissions inside the container, not by inspecting
   * what the agent asks for: everything outside the list loses its "other"
   * bits while the agent runs as a uid that owns none of them. So an
   * absolute path, a shell alias or a renamed copy do not get around it —
   * unlike a list of tool names, which bash makes porous the moment one
   * entry can invoke another program.
   */
  commands: string[];
}

export const SANDBOX_DEFAULTS: Omit<SandboxProfile, "enabled"> = {
  image: AGENT_IMAGE,
  network: "open",
  allow: [],
  commands: [],
  memory: "2g",
  cpus: "2",
  pids: 512,
  env: [],
};

/**
 * Read the `sandbox:` block of an agent.yml. Absent = undefined (host, as
 * before); a bare key = on with defaults; `enabled: false` keeps the block
 * and turns it off — the same shape as the other optional blocks.
 */
export function normalizeSandbox(raw: unknown): SandboxProfile | undefined {
  if (raw === undefined || raw === null || raw === false) return undefined;
  const o = (typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const network =
    o.network === "none" ? "none" : o.network === "allowlist" ? "allowlist" : "open";
  const pids = Number(o.pids);
  return {
    enabled: o.enabled !== false,
    image: strOr(o.image, IMAGE_RE, SANDBOX_DEFAULTS.image),
    network,
    allow: listOf(o.allow, HOST_RE),
    memory: strOr(o.memory, MEMORY_RE, SANDBOX_DEFAULTS.memory),
    cpus: strOr(o.cpus, CPUS_RE, SANDBOX_DEFAULTS.cpus),
    pids: Number.isFinite(pids) && pids > 0 ? Math.floor(pids) : SANDBOX_DEFAULTS.pids,
    env: listOf(o.env, ENV_RE),
    commands: listOf(o.commands, COMMAND_RE),
  };
}

/**
 * Short, stable discriminator for one workspace on this host. Several
 * kraftwerk instances share a Docker daemon, and two of them may well have
 * an agent with the same slug.
 */
const workspaceTag = (projectRoot: string): string =>
  createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 8);

export const containerFor = (projectRoot: string, slug: string): string =>
  `kw-agent-${workspaceTag(projectRoot)}-${slug}`;

/** The agent's home volume: CLI logins and adapter state survive a container replacement. */
const homeVolumeFor = (projectRoot: string, slug: string): string =>
  `kw-home-${workspaceTag(projectRoot)}-${slug}`;

/**
 * The agent's own working directory, mounted at the project root's path so
 * `cwd` needs no translation upstream. It starts empty — the workspace is
 * never bind-mounted, only the granted parts are — and persists, so files
 * the agent makes for itself survive a restart.
 */
const scratchVolumeFor = (projectRoot: string, slug: string): string =>
  `kw-ws-${workspaceTag(projectRoot)}-${slug}`;

/** The internal network an allowlisted agent is alone on, with its proxy. */
const egressNetworkFor = (projectRoot: string, slug: string): string =>
  `kw-egress-${workspaceTag(projectRoot)}-${slug}`;

const proxyContainerFor = (projectRoot: string, slug: string): string =>
  `kw-proxy-${workspaceTag(projectRoot)}-${slug}`;

/** The port the egress proxy listens on inside its container. */
const PROXY_PORT = 8888;

/**
 * One docker invocation. Async throughout: `ensureAgentContainer` runs on
 * the request path of the inspector, and a synchronous `docker run` there
 * would freeze every other chat for the duration of the start.
 */
function docker(args: string[], timeout = 60_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    timer.unref?.();
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, out: "", err: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out: out.trim(), err: err.trim() });
    });
  });
}

export async function dockerAvailable(): Promise<boolean> {
  return (await docker(["version", "--format", "ok"], 10_000)).code === 0;
}

export async function imageExists(image = AGENT_IMAGE): Promise<boolean> {
  return (await docker(["image", "inspect", image], 15_000)).code === 0;
}

async function containerState(name: string): Promise<"running" | "stopped" | "absent"> {
  const r = await docker(["inspect", "-f", "{{.State.Running}}", name], 15_000);
  if (r.code !== 0) return "absent";
  return r.out === "true" ? "running" : "stopped";
}

/**
 * Make sure this agent's container is up, and return its name. Idempotent:
 * a running container is reused, a stopped one is replaced (its profile may
 * have changed since, and the state that matters lives in the home volume).
 */
export interface SandboxStart {
  slug: string;
  projectRoot: string;
  /** Where runs land; `<outputDir>/runs` is mounted writable (see startContainer). */
  outputDir: string;
  profile: SandboxProfile;
  /** Everything the agent may see. Omitted = an empty workspace. */
  grants?: SandboxGrants;
}

export function ensureAgentContainer(opts: SandboxStart): Promise<string> {
  const name = containerFor(opts.projectRoot, opts.slug);
  // Two seats opening at once must not both `docker run --name <same>`:
  // the second would fail on the name. They share one start instead.
  const inFlight = starting.get(name);
  if (inFlight) return inFlight;
  const started = startContainer(name, opts).finally(() => starting.delete(name));
  starting.set(name, started);
  return started;
}

/** Container starts in progress, by container name (see ensureAgentContainer). */
const starting = new Map<string, Promise<string>>();

/**
 * Mount the granted entries of one shared root. An entry is a folder
 * (`knowledge/<bundle>`, `workflows/<name>`) or, for workflows, a single
 * `<name>.yml`. `allow: null` mounts the whole root — the existing meaning
 * of an omitted `skills:` in agent.yml. Entries that do not exist are
 * skipped rather than created, because Docker would otherwise invent them
 * as empty and root-owned. Nothing is masked because nothing is exposed:
 * the root only exists inside the container as far as these mounts make it.
 */
function grantMounts(
  grant: { root: string; allow: string[] | null } | undefined,
  hosts: HostPaths,
  opts: { readonly: boolean }
): string[] {
  if (!grant) return [];
  const root = path.resolve(grant.root);
  if (!existsSync(root) || root.includes(",")) return [];
  const mode = opts.readonly ? ",readonly" : "";
  const mount = (source: string): string[] => [
    "--mount",
    `type=bind,source=${source},target=${sandboxPath(source, hosts)}${mode}`,
  ];
  if (grant.allow === null) return mount(root);
  const args: string[] = [];
  for (const name of grant.allow) {
    if (!GRANT_NAME_RE.test(name)) continue;
    const dir = path.join(root, name);
    const file = `${dir}.yml`;
    const source = existsSync(dir) ? dir : existsSync(file) ? file : null;
    if (!source || source.includes(",")) continue;
    args.push(...mount(source));
  }
  return args;
}

/**
 * Bring up the egress side of an allowlisted sandbox and return the network
 * the agent must join.
 *
 * Two pieces. The network is `--internal`: nothing on it reaches the outside,
 * which is what makes the allowlist a boundary rather than a setting. The
 * proxy container is started on ordinary bridge networking — so it *can*
 * reach the outside — and then attached to the internal network as well, so
 * it is the single door. Both are replaced whenever the allowlist changes;
 * an old proxy still serving a stale list is the one failure mode here that
 * nobody would notice.
 */
async function ensureEgress(opts: SandboxStart): Promise<string> {
  const { slug, projectRoot, profile } = opts;
  const network = egressNetworkFor(projectRoot, slug);
  const proxy = proxyContainerFor(projectRoot, slug);
  const wanted = profile.allow.join(",");

  const current = await docker(
    ["inspect", "-f", "{{index .Config.Labels \"kraftwerk.egress.allow\"}}", proxy],
    15_000
  );
  const running = (await containerState(proxy)) === "running";
  if (running && current.code === 0 && current.out === wanted) return network;

  await docker(["rm", "-f", proxy], 30_000);
  // `docker network create` is idempotent enough: an existing one errors and
  // that is fine, it is the same network either way.
  await docker(["network", "create", "--internal", network], 30_000);

  const args = [
    "run", "-d",
    "--name", proxy,
    "--label", "kraftwerk.agent.proxy",
    "--label", `kraftwerk.agent.slug=${slug}`,
    "--label", `kraftwerk.agent.workspace=${path.resolve(projectRoot)}`,
    "--label", `kraftwerk.egress.allow=${wanted}`,
    "--memory", "256m",
    "--security-opt", "no-new-privileges",
    profile.image,
    "kraftwerk", "egress-proxy", "--port", String(PROXY_PORT), "--allow", wanted,
  ];
  const started = await docker(args, 60_000);
  if (started.code !== 0) {
    throw new Error(`could not start the egress proxy for "${slug}": ${started.err || started.out}`);
  }
  const joined = await docker(["network", "connect", network, proxy], 30_000);
  if (joined.code !== 0) {
    await docker(["rm", "-f", proxy], 30_000);
    throw new Error(`could not attach the egress proxy for "${slug}": ${joined.err || joined.out}`);
  }
  return network;
}

async function startContainer(name: string, opts: SandboxStart): Promise<string> {
  const { slug, projectRoot, profile } = opts;
  const state = await containerState(name);
  if (state === "running") return name;
  if (!(await dockerAvailable())) throw new Error("Docker daemon not reachable — start Docker first.");
  if (!(await imageExists(profile.image))) {
    throw new Error(`Image "${profile.image}" not found — run \`kraftwerk sandbox build\` first.`);
  }
  // A stopped container may predate an edit to the profile; the state that
  // has to survive lives in the home volume, so replace it rather than start it.
  if (state === "stopped") await docker(["rm", "-f", name], 30_000);
  // Docker would create a missing bind source itself, owned by root.
  await mkdir(path.join(path.resolve(opts.outputDir), "runs"), { recursive: true }).catch(() => {});

  // The proxy has to exist before the agent joins its network, and a change
  // to `allow` must reach the agent — so this runs on every (re)start.
  const egressNetwork = profile.network === "allowlist" ? await ensureEgress(opts) : "";
  const root = path.resolve(projectRoot);
  // `--mount` parses comma-separated key=value pairs; a comma in the path
  // would silently become another option. Say so instead of half-mounting.
  if (root.includes(",")) {
    throw new Error(`workspace path contains a comma, which Docker cannot bind-mount: ${root}`);
  }
  const args = [
    "run", "-d",
    "--name", name,
    "--label", "kraftwerk.agent",
    "--label", `kraftwerk.agent.slug=${slug}`,
    "--label", `kraftwerk.agent.workspace=${root}`,
    "--memory", profile.memory,
    "--cpus", profile.cpus,
    "--pids-limit", String(profile.pids),
    "--security-opt", "no-new-privileges",
    ...(profile.network === "none" ? ["--network", "none"] : []),
    ...(egressNetwork ? ["--network", egressNetwork] : []),
    // An empty volume at /workspace: the agent's own working directory. The
    // workspace itself is never mounted — only what the grants below name.
    //
    // `--mount` rather than `-v` throughout: with a bind whose source and
    // target are the same path, `-v <p>:<p>:ro` is unreliable on Docker
    // Desktop for macOS (the target comes up empty) and `-v <p>:<p>:rw` is
    // worse (the mount lands at "<p>w"). `--mount` is exact and repeatable.
    "--mount", `type=volume,source=${scratchVolumeFor(projectRoot, slug)},target=${SANDBOX_ROOT}`,
    "--mount", `type=volume,source=${homeVolumeFor(projectRoot, slug)},target=/root`,
    "-e", "HOME=/root",
  ];
  // Where runs land, so the agent can execute its granted workflows inside
  // its own sandbox. Deliberately `<output>/runs` and not `<output>`: the
  // chat transcripts live in `<output>/chats`, and an agent must never be
  // able to edit its own record.
  const hosts: HostPaths = { projectRoot: root, outputDir: path.resolve(opts.outputDir) };
  const runs = path.join(hosts.outputDir, "runs");
  if (runs.includes(",")) throw new Error(`runs path contains a comma: ${runs}`);
  args.push("--mount", `type=bind,source=${runs},target=${sandboxPath(runs, hosts)}`);
  // kraftwerk.yml, so `kraftwerk run` can resolve the project from cwd.
  if (opts.grants?.config && existsSync(opts.grants.config)) {
    const cfg = path.resolve(opts.grants.config);
    if (!cfg.includes(",")) {
      args.push("--mount", `type=bind,source=${cfg},target=${sandboxPath(cfg, hosts)},readonly`);
    }
  }
  // Writable: knowledge, because agents maintain their own bundles.
  // Read-only: workflows and skills, because those are definitions.
  args.push(...grantMounts(opts.grants?.knowledge, hosts, { readonly: false }));
  args.push(...grantMounts(opts.grants?.workflows, hosts, { readonly: true }));
  args.push(...grantMounts(opts.grants?.skills, hosts, { readonly: true }));
  args.push(...grantMounts(opts.grants?.repos, hosts, { readonly: true }));
  if (opts.grants?.uploads) {
    args.push(...grantMounts({ root: opts.grants.uploads.root, allow: null }, hosts, { readonly: true }));
  }
  // The agent's processes run as the host's uid: not root (so the command
  // allowlist can be enforced with permissions) and not a stranger either
  // (so bind-mounted files stay writable). A kraftwerk running as root has
  // no non-root identity to hand down, and the restriction cannot hold —
  // say so rather than pretend.
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  if (profile.commands.length > 0 && uid === 0) {
    throw new Error(
      `sandbox.commands for "${slug}" cannot be enforced: kraftwerk runs as root, so the agent would too. Run the inspector as an ordinary user.`
    );
  }
  args.push("-e", `KRAFTWERK_AGENT_UID=${uid}`, "-e", `KRAFTWERK_AGENT_GID=${gid}`);
  if (profile.commands.length > 0) {
    args.push("-e", `KRAFTWERK_ALLOW_COMMANDS=${profile.commands.join(",")}`);
  }
  if (egressNetwork) {
    // Both spellings: the harness CLIs and the tools they shell out to
    // disagree about which one they read.
    const url = `http://${proxyContainerFor(projectRoot, slug)}:${PROXY_PORT}`;
    for (const [key, value] of [
      ["HTTP_PROXY", url],
      ["HTTPS_PROXY", url],
      ["http_proxy", url],
      ["https_proxy", url],
      ["NO_PROXY", "localhost,127.0.0.1"],
      ["no_proxy", "localhost,127.0.0.1"],
    ]) {
      args.push("-e", `${key}=${value}`);
    }
  }
  for (const key of [...PASSTHROUGH_ENV, ...profile.env]) {
    if (process.env[key] !== undefined) args.push("-e", key);
  }
  // No command: the image's entrypoint (kw-sandbox-init) applies the
  // per-agent policy before anything can exec into the container, then
  // idles. Overriding it here would silently skip that.
  args.push(profile.image);

  const r = await docker(args, 120_000);
  if (r.code !== 0) {
    throw new Error(`could not start the sandbox for "${slug}": ${r.err || r.out}`);
  }
  await waitReady(name, slug);
  return name;
}

/**
 * Wait until the container's init has finished applying the policy.
 *
 * `docker run -d` returns as soon as the container exists, which is well
 * before the command allowlist is in place. Handing the name back then
 * would let the adapter exec into a container that is only half restricted
 * — and, worse, do it differently depending on how busy the machine is.
 */
async function waitReady(name: string, slug: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const r = await docker(["exec", name, "test", "-f", "/run/kw-sandbox-ready"], 15_000);
    if (r.code === 0) return;
    if ((await containerState(name)) !== "running") {
      const logs = await docker(["logs", "--tail", "20", name], 15_000);
      throw new Error(`the sandbox for "${slug}" exited while starting: ${logs.err || logs.out}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`the sandbox for "${slug}" did not finish starting within 60s`);
    }
    await new Promise((r2) => setTimeout(r2, 250));
  }
}

/**
 * How to launch this agent's ACP adapter inside its container. `env` carries
 * the per-session tuning (thinking budget, codex config) that adapterEnv()
 * would otherwise put in the child's environment — inside a container only
 * what is named here crosses over, never the inspector's whole environment.
 */
/**
 * The identity everything inside a sandbox runs as.
 *
 * One function, because the answer has to be the same everywhere: an agent
 * whose adapter runs as one user and whose `sandbox login` ran as another
 * writes credentials it cannot read back, and reports itself signed out
 * with the file sitting right there.
 *
 * HOME is spelled out because this uid has no passwd entry in the image,
 * and a harness with no home keeps neither its login nor its sessions.
 */
export function agentExecArgs(): string[] {
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  return uid === 0 ? [] : ["--user", `${uid}:${gid}`, "-e", "HOME=/root"];
}

export function adapterLaunch(opts: {
  container: string;
  agent: AcpAgent;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): { command: string; args: string[] } {
  const args = ["exec", "-i", "-w", opts.cwd, ...agentExecArgs()];
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    if (value !== undefined) args.push("-e", `${key}=${value}`);
  }
  args.push(opts.container, ADAPTER_BIN[opts.agent]);
  return { command: "docker", args };
}

export interface AgentContainer {
  slug: string;
  workspace: string;
  container: string;
  status: string;
}

/** Running agent sandboxes on this host (every workspace, or just one). */
export async function listAgentContainers(projectRoot?: string): Promise<AgentContainer[]> {
  const r = await docker(
    ["ps", "--filter", "label=kraftwerk.agent", "--format",
     '{{.Label "kraftwerk.agent.slug"}}\t{{.Label "kraftwerk.agent.workspace"}}\t{{.Names}}\t{{.Status}}'],
    15_000
  );
  if (r.code !== 0) return [];
  const rows = r.out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [slug, workspace, container, status] = line.split("\t");
      return { slug, workspace, container, status };
    });
  if (!projectRoot) return rows;
  const root = path.resolve(projectRoot);
  return rows.filter((row) => row.workspace === root);
}

/** Stop and remove one agent's sandbox. Returns false when there was none. */
export async function stopAgentContainer(projectRoot: string, slug: string): Promise<boolean> {
  const name = containerFor(projectRoot, slug);
  const had = (await containerState(name)) !== "absent";
  const removed = had ? (await docker(["rm", "-f", name], 45_000)).code === 0 : false;
  // The proxy exists only to serve this agent; leaving it running would keep
  // a door open onto a network with nobody behind it.
  await docker(["rm", "-f", proxyContainerFor(projectRoot, slug)], 30_000);
  await docker(["network", "rm", egressNetworkFor(projectRoot, slug)], 30_000);
  return removed;
}

/**
 * Drop the agent's sandbox and its home volume — the logins and adapter
 * state that deliberately survive a restart. A deleted agent has to take
 * its credentials with it; otherwise the volume outlives every trace of
 * the agent and nothing on screen ever mentions it again.
 */
export async function removeAgentSandbox(projectRoot: string, slug: string): Promise<void> {
  await stopAgentContainer(projectRoot, slug).catch(() => false);
  await docker(["rm", "-f", proxyContainerFor(projectRoot, slug)], 30_000);
  await docker(["network", "rm", egressNetworkFor(projectRoot, slug)], 30_000);
  await docker(["volume", "rm", "-f", homeVolumeFor(projectRoot, slug)], 30_000);
  await docker(["volume", "rm", "-f", scratchVolumeFor(projectRoot, slug)], 30_000);
}

/**
 * Build (or rebuild) the agent sandbox image. Streams docker output.
 *
 * `local` packs this checkout instead of installing kraftwerk from npm —
 * the only way to try a sandbox-side change (the egress proxy, a CLI the
 * agent runs) before it is released.
 */
export function buildAgentImage(opts: { version?: string; local?: boolean } = {}): void {
  const context = path.join(frameworkDir, "runner");
  const dockerfile = path.join(context, "agent.Dockerfile");
  if (!existsSync(dockerfile)) throw new Error(`${dockerfile} missing`);
  const args = ["build", "-t", AGENT_IMAGE, "-f", dockerfile];

  if (opts.local) {
    for (const stale of readdirSync(context).filter((f) => f.endsWith(".tgz"))) {
      rmSync(path.join(context, stale), { force: true });
    }
    // npm pack ships whatever `files` names, so dist/ has to be current.
    const built = spawnSync("npm", ["run", "build"], { cwd: frameworkDir, stdio: "inherit" });
    if (built.status !== 0) throw new Error("npm run build failed — cannot pack this checkout");
    const packed = spawnSync("npm", ["pack", "--pack-destination", context], {
      cwd: frameworkDir,
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (packed.status !== 0) throw new Error("npm pack failed");
    args.push("--build-arg", "KRAFTWERK_SRC=local");
  } else if (opts.version) {
    args.push("--build-arg", `KRAFTWERK_VERSION=${opts.version}`);
  }

  args.push(context);
  const r = spawnSync("docker", args, { stdio: "inherit" });
  if (opts.local) {
    for (const f of readdirSync(context).filter((f) => f.endsWith(".tgz"))) {
      rmSync(path.join(context, f), { force: true });
    }
  }
  if (r.status !== 0) throw new Error(`docker build failed (exit ${r.status})`);
}
