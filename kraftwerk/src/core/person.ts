import { AsyncLocalStorage } from "node:async_hooks";
import { resolveWorkspace, usersMode } from "../config.js";
import { readAccountFile } from "./cloud.js";
import { workspaceRoot } from "./context.js";
import { readIdentity } from "./identity.js";

/**
 * Who a human change is signed with — the person behind a request, else
 * the machine's own.
 *
 * A person is a handle, and with `users: cloud` (kraftwerk.yml, see
 * UsersConfig) also the cloud account's uuid and email: the same person on
 * every machine and clone. Logs and provenance write `human:<handle>`
 * (readable; the cloud keeps handles unique); chats keep the whole person.
 *
 * The server runs every API call as its caller (`runAs`, router.ts): a
 * signed-in browser, a remote member, this machine. Outside a request —
 * the CLI, a routine — it is the machine's person:
 *
 *   users: local   the identity handle (~/.kraftwerk/identity.json)
 *   users: cloud   the account that claimed the machine (~/.kraftwerk/account.json),
 *                  the identity handle while there is none
 *
 * A `human:` actor is never taken from what a caller of the API says:
 * whoever asks is who it is (`actorFor`). The machine's own shell (the CLI,
 * outside any request) may still name one — it can edit the files anyway.
 * Other actors — `lisa/claude`, `process:sync` — are agents and processes
 * naming themselves, and stand as given.
 */

export interface Person {
  handle: string;
  /** The cloud account's uuid (users: cloud, or a remote member's when the cloud says it). */
  id?: string;
  email?: string;
}

const storage = new AsyncLocalStorage<() => Promise<Person>>();

/** Run `fn` as the person `who` resolves to (resolved once, when first asked). */
export function runAs<T>(who: () => Promise<Person>, fn: () => T): T {
  let memo: Promise<Person> | undefined;
  return storage.run(() => (memo ??= who()), fn);
}

/** This machine's person: the claiming account in a `users: cloud` workspace, else the identity handle. */
export async function machinePerson(): Promise<Person> {
  // The CLI runs outside any served workspace: the one around its cwd.
  let root: string;
  try {
    root = workspaceRoot();
  } catch {
    root = process.cwd();
  }
  const cloud = await resolveWorkspace(root)
    .then((ws) => usersMode(ws.config) === "cloud")
    .catch(() => false);
  if (cloud) {
    const account = await readAccountFile();
    if (account) return { handle: account.handle, id: account.id, email: account.email };
  }
  return { handle: (await readIdentity()).handle };
}

/** The person the current request runs as, else this machine's. */
export async function currentPerson(): Promise<Person> {
  const who = storage.getStore();
  return who ? who() : machinePerson();
}

export const humanActor = (p: Pick<Person, "handle">): string => `human:${p.handle}`;

/**
 * The actor a change is stamped with: an agent's or a process's own name as
 * given, else the person asking — in a request a given `human:…` too.
 */
export async function actorFor(given?: string): Promise<string> {
  const g = (given ?? "").trim();
  if (g && (!g.startsWith("human:") || !storage.getStore())) return g;
  return humanActor(await currentPerson());
}
