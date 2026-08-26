import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./context.js";
import { RUN_ID_RE, safeRunDir } from "./runs.js";
import { newRunId } from "../workflow.js";

/**
 * Workflow trigger for the web UI. The inspector stays decoupled from the
 * framework runtime: it shells out to `npx kraftwerk run` in the consumer
 * project, detached, with a pre-chosen --run-id so the browser can jump to
 * /runs/<id> immediately and watch the (already polling) live timeline.
 *
 * Sandbox mode adds --sandbox: one Docker container per run, workflow
 * mounted read-only, run dir bind-mounted back into output/ (see
 * kraftwerk/src/runner/docker.ts).
 */

export function dockerStatus(): { available: boolean; image: boolean } {
  const daemon = spawnSync("docker", ["version", "--format", "ok"], {
    stdio: "ignore",
    timeout: 8000,
  });
  if (daemon.status !== 0) return { available: false, image: false };
  const image = spawnSync("docker", ["image", "inspect", "kraftwerk-runner"], {
    stdio: "ignore",
    timeout: 8000,
  });
  return { available: true, image: image.status === 0 };
}

export function triggerRun(opts: {
  workflowName: string;
  request: string;
  sandbox: boolean;
  ssh: boolean;
}): { runId: string } {
  if (opts.sandbox) {
    const docker = dockerStatus();
    if (!docker.available) throw new Error("Docker daemon not reachable — start Docker first.");
    if (!docker.image) throw new Error('Image "kraftwerk-runner" missing — run `kraftwerk runner build`.');
  }

  const runId = newRunId(opts.workflowName);
  // Matches the CLI's --run-id resolution: <output dir>/runs/<id>.
  const runDir = safeRunDir(runId);
  mkdirSync(runDir, { recursive: true });
  const log = openSync(path.join(runDir, "trigger.log"), "a");

  const args = ["kraftwerk", "run", "--yes", "--run-id", runId];
  if (opts.sandbox) args.push("--sandbox");
  if (opts.ssh) args.push("--ssh");
  args.push(opts.workflowName, opts.request);

  const child = spawn("npx", args, {
    cwd: getProjectRoot(),
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  child.unref();
  closeSync(log);
  return { runId };
}

export function stopRun(runId: string): boolean {
  // Sandboxed runs run in container kw-<runId>; docker stop ends them.
  if (!RUN_ID_RE.test(runId)) return false;
  return (
    spawnSync("docker", ["stop", `kw-${runId}`], { stdio: "ignore", timeout: 30_000 }).status === 0
  );
}
