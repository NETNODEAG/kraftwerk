import * as z from "zod";
import { workspaceRoot } from "../../core/context.js";
import { CREDENTIAL_KINDS, removeCredential, setCredential } from "../../core/harness-credentials.js";
import { forgetHarnessAuth, harnessStatuses } from "../../core/harness-status.js";
import type { HarnessId } from "../../harness.js";
import { ApiError, fail, route, type Ctx } from "./router.js";

const Scope = z.enum(["workspace", "machine"]).default("workspace");
/** What a harness signs in with; the value is stored and never returned. */
const Credential = z.object({ kind: z.enum(["api_key", "subscription_token"]), value: z.string().min(1), scope: Scope });

function harnessId(raw: string): HarnessId {
  if (!(raw in CREDENTIAL_KINDS)) fail(404, `no harness "${raw}"`);
  return raw as HarnessId;
}

/** Where people sign in with their cloud account (a sandbox, `users: cloud`), keys are the owner's to set — a member uses them. */
function ownerOnly(c: Pick<Ctx, "trust">): void {
  if (c.trust.kind === "local" && c.trust.user && c.trust.user.role !== "owner") fail(403, "only an owner of the workspace sets what its harnesses sign in with");
}

/** The harnesses agents run on here, and what each signs in with (core/harness-status.ts, core/harness-credentials.ts). */
export const harnessRoutes = [
  route({ name: "harnesses.list", method: "GET", path: "/api/harnesses", summary: "every harness: usable here, what it signs in with (never a key's value)" }, async () => ({ harnesses: harnessStatuses() })),
  route(
    {
      name: "harnesses.setCredential",
      method: "PUT",
      path: "/api/harnesses/:id/credential",
      summary: "store what a harness signs in with {kind: api_key|subscription_token, value, scope: workspace|machine}",
      access: "local",
      errors: 400,
      body: Credential,
    },
    async (c) => {
      ownerOnly(c);
      const id = harnessId(c.params.id);
      const { kind, value, scope } = await c.body();
      try {
        const credential = setCredential(workspaceRoot(), id, scope, kind, value);
        forgetHarnessAuth(workspaceRoot(), id);
        return { ok: true, credential };
      } catch (err) {
        throw new ApiError(400, (err as Error).message);
      }
    },
  ),
  route(
    { name: "harnesses.removeCredential", method: "DELETE", path: "/api/harnesses/:id/credential", summary: "forget a harness's stored credential ?scope=workspace|machine", access: "local" },
    async (c) => {
      ownerOnly(c);
      const id = harnessId(c.params.id);
      const scope = Scope.safeParse(c.query.get("scope") ?? undefined);
      if (!scope.success) fail(400, "scope is workspace or machine");
      const removed = removeCredential(workspaceRoot(), id, scope.data);
      if (removed) forgetHarnessAuth(workspaceRoot(), id);
      return { ok: true, removed };
    },
  ),
];
