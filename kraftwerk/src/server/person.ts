import { machinePerson, type Person } from "../core/person.js";
import type { Trust } from "./trust.js";

/**
 * The person behind a caller (core/person.ts): the account a browser signed
 * in with (`users: cloud`), a remote member as the cloud vouched for them,
 * else this machine's person — a paired device, this machine's own shell,
 * any request in a `users: local` workspace.
 */
export async function personOf(trust: Trust): Promise<Person> {
  if (trust.kind === "local" && trust.user) return { handle: trust.user.user.handle, id: trust.user.user.id, email: trust.user.user.email };
  if (trust.kind === "member") return { handle: trust.member.handle, email: trust.member.email };
  return machinePerson();
}
