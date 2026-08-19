import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStamp } from "../workflow.js";

/**
 * Docker sandbox runner: one container per workflow run.
 *
 * The container gets
 *   - the workflow folder, mounted read-only at /work/src/workflows/<name>
 *   - the host run directory, bind-mounted at /work/output/<run-id> — so
 *     trace.jsonl and all artifacts land on the host LIVE while the run
 *     executes (no copy-back step needed; the inspector polls as usual)
 *   - env vars from <project>/runner.env (if present) plus pass-through of
 *     ANTHROPIC_API_KEY / OPENAI_API_KEY from the host environment
 *   - optionally the host SSH agent socket + known_hosts (`ssh: true`)
 *
 * Inside, plain `kraftwerk run --yes` executes; KRAFTWERK_RUN_DIR pins the
 * run directory to the mount. Container name kw-<run-id> and label
 * kraftwerk.run make runs discoverable and cancellable (`docker stop`).
 */

const IMAGE = "kraftwerk-runner";
const ENV_FILE = "runner.env";
const PASSTHROUGH_ENV = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

/** Framework package root (contains runner/Dockerfile). */
const frameworkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface SandboxOptions {
  /** Consumer project root (where output/ lives). */
  projectRoot: string;
  /** Workflow folder (folder mode) or .yml file path. */
  workflowPath: string;
  /** Workflow name as declared in the YAML (used for `kraftwerk run <name>`). */
  workflowName: string;
  request: string;
  /** Pre-chosen run id (run-...); generated when omitted. */
  runId?: string;
  /** Forward the host SSH agent + known_hosts into the container. */
  ssh?: boolean;
  /** "attach": inherit stdio, await completion (CLI). "detach": stdio to runner.log, survives the parent (web trigger). */
  mode: "attach" | "detach";
  memory?: string;
  cpus?: string;
}

export interface SandboxHandle {
  runId: string;
  runDir: string;
  containerName: string;
  /** Resolves with the docker exit code (attach mode only awaits it). */
  finished: Promise<number>;
}

export function dockerAvailable(): string | null {
  const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (r.status !== 0) return null;
  return r.stdout.trim() || "unknown";
}

export function imageExists(): boolean {
  return spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }).status === 0;
}

/** Build (or rebuild) the kraftwerk-runner image. Streams docker output. */
export async function buildImage(): Promise<void> {
  const dockerfile = path.join(frameworkDir, "runner", "Dockerfile");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "docker",
      ["build", "-t", IMAGE, "-f", dockerfile, frameworkDir],
      { stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`docker build failed (exit ${code})`))
    );
  });
}

export async function runSandboxed(opts: SandboxOptions): Promise<SandboxHandle> {
  if (!dockerAvailable()) {
    throw new Error("Docker daemon not reachable — is Docker running?");
  }
  if (!imageExists()) {
    throw new Error(`Image "${IMAGE}" not found — run \`kraftwerk runner build\` first.`);
  }

  const runId = opts.runId ?? `run-${runStamp()}`;
  const runDir = path.join(opts.projectRoot, "output", runId);
  await mkdir(runDir, { recursive: true });
  const containerName = `kw-${runId}`;

  // Folder mode and single-file mode both mount under src/workflows/ so
  // the in-container discovery finds exactly this one workflow.
  const wfAbs = path.resolve(opts.workflowPath);
  const wfTarget = `/work/src/workflows/${path.basename(wfAbs)}`;

  const args = [
    "run", "--rm",
    "--name", containerName,
    "--label", `kraftwerk.run=${runId}`,
    "--label", `kraftwerk.workflow=${opts.workflowName}`,
    "--memory", opts.memory ?? "2g",
    "--cpus", opts.cpus ?? "2",
    "-v", `${wfAbs}:${wfTarget}:ro`,
    "-v", `${runDir}:/work/output/${runId}`,
    "-e", `KRAFTWERK_RUN_DIR=/work/output/${runId}`,
  ];

  const envFile = path.join(opts.projectRoot, ENV_FILE);
  if (existsSync(envFile)) args.push("--env-file", envFile);
  for (const key of PASSTHROUGH_ENV) {
    if (process.env[key]) args.push("-e", key);
  }

  if (opts.ssh) {
    // Docker Desktop (macOS) exposes the host agent at a magic path; on
    // Linux the socket path can be mounted directly.
    const sock =
      os.platform() === "darwin" ? "/run/host-services/ssh-auth.sock" : process.env.SSH_AUTH_SOCK;
    if (sock) {
      args.push(
        "-v", `${os.platform() === "darwin" ? "/run/host-services/ssh-auth.sock" : sock}:/ssh-agent.sock`,
        "-e", "SSH_AUTH_SOCK=/ssh-agent.sock"
      );
    }
    const knownHosts = path.join(os.homedir(), ".ssh", "known_hosts");
    if (existsSync(knownHosts)) {
      args.push("-v", `${knownHosts}:/root/.ssh/known_hosts:ro`);
    }
  }

  args.push(IMAGE, "kraftwerk", "run", "--yes", opts.workflowName, opts.request);

  await writeFile(
    path.join(runDir, "runner.json"),
    JSON.stringify(
      {
        container: containerName,
        image: IMAGE,
        workflow: opts.workflowName,
        request: opts.request,
        ssh: !!opts.ssh,
        startedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );

  let exited: Promise<number>;
  if (opts.mode === "attach") {
    const child = spawn("docker", args, { stdio: "inherit" });
    exited = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });
  } else {
    // Detached: docker client keeps running after the parent (e.g. the
    // inspector dev server) exits; all output goes to runner.log.
    const log = await open(path.join(runDir, "runner.log"), "a");
    const child = spawn("docker", args, {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    exited = new Promise((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
    child.unref();
    await log.close();
  }

  // Record the outcome before anyone (e.g. the CLI's process.exit) can act
  // on the resolved exit code. Best effort only in detach mode — the parent
  // may be gone; trace.jsonl still tells the story.
  const finished = exited.then(async (code) => {
    try {
      const p = path.join(runDir, "runner.json");
      const meta = JSON.parse(await readFile(p, "utf8"));
      meta.exitCode = code;
      meta.finishedAt = new Date().toISOString();
      await writeFile(p, JSON.stringify(meta, null, 2) + "\n");
    } catch {
      /* ignore */
    }
    return code;
  });

  return { runId, runDir, containerName, finished };
}

/** Running kraftwerk sandbox containers: [{ runId, workflow, container, status }]. */
export function listSandboxes(): Array<{
  runId: string;
  workflow: string;
  container: string;
  status: string;
}> {
  const r = spawnSync(
    "docker",
    ["ps", "--filter", "label=kraftwerk.run", "--format",
     '{{.Label "kraftwerk.run"}}\t{{.Label "kraftwerk.workflow"}}\t{{.Names}}\t{{.Status}}'],
    { encoding: "utf8" }
  );
  if (r.status !== 0) return [];
  return r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [runId, workflow, container, status] = line.split("\t");
      return { runId, workflow, container, status };
    });
}

/** Stop a sandboxed run by run id. Returns false when no such container. */
export function stopSandbox(runId: string): boolean {
  return spawnSync("docker", ["stop", `kw-${runId}`], { stdio: "ignore", timeout: 30_000 }).status === 0;
}
