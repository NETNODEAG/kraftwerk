import { AsyncLocalStorage } from "node:async_hooks";
import type { Hub } from "./server.js";

/**
 * The hub a request runs in, like the workspace (core/workspace.ts): the
 * machine-level routes (hub.*) find theirs here, so several hubs in one
 * process (tests) never act on each other's workspaces.
 */
const storage = new AsyncLocalStorage<Hub>();

export const runInHub = <T>(hub: Hub, fn: () => T): T => storage.run(hub, fn);

export function currentHub(): Hub {
  const hub = storage.getStore();
  if (!hub) throw new Error("no hub here");
  return hub;
}

/** API paths that need no workspace: the machine's own (the hub, devices and pairing, the protocol, the socket). */
export const MACHINE_PATHS = /^\/api\/(hub(\/|$)|pair$|devices(\/|$)|protocol$|ws$)/;
/** Route names callable over the socket without a workspace. */
export const MACHINE_ROUTES = /^(hub|devices|protocol)\./;
