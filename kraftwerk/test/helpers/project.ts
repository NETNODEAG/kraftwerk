import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * A throwaway kraftwerk project inside its own git repo, plus a private HOME
 * so the ~/.kraftwerk registries the inspector writes never touch the real
 * ones. One fixture per test file: the inspector keeps its project root in
 * module state, so a process serves exactly one project.
 */
export interface Fixture {
  root: string;
  home: string;
  /** Run git inside the fixture repo and return trimmed stdout. */
  git(...args: string[]): string;
  /** Write a file relative to the project root, creating directories. */
  write(rel: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

const DEFAULT_CONFIG = "name: fixture\ngit:\n  interval: 0\n";

export async function makeProject(config = DEFAULT_CONFIG): Promise<Fixture> {
  const base = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-"));
  const root = path.join(base, "project");
  const home = path.join(base, "home");
  await mkdir(root, { recursive: true });
  await mkdir(home, { recursive: true });
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = async (rel: string, content: string): Promise<void> => {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  await write("kraftwerk.yml", config);
  await write("knowledge/notes.md", "# notes\n");
  return {
    root,
    home,
    git,
    write,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

/** An empty directory with its own HOME, for commands that scaffold a project themselves (`kraftwerk init`). */
export async function makeEmptyDir(): Promise<{ root: string; home: string; cleanup(): Promise<void> }> {
  const base = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-"));
  const root = path.join(base, "project");
  const home = path.join(base, "home");
  await mkdir(root, { recursive: true });
  await mkdir(home, { recursive: true });
  return { root, home, cleanup: () => rm(base, { recursive: true, force: true }) };
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Start the real inspector on a free port against the fixture. HOME is
 * swapped before the server module loads, because the registry paths are
 * resolved at import time.
 */
export async function startServer(fx: Fixture): Promise<RunningServer> {
  process.env.HOME = fx.home;
  const { startInspector } = await import("../../src/inspector/server.js");
  const server = await startInspector({
    outputDir: path.join(fx.root, "output"),
    staticDir: fx.root,
    port: 0,
    projectRoot: fx.root,
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
