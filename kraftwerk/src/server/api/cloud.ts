import * as z from "zod";
import { writeCloudFile } from "../../core/cloud.js";
import { applyMachineCloud, cloudStatus, createWorkspaceInvite, syncMachineCloud, unlinkMachineCloud } from "../cloud.js";
import { currentHub } from "../hub-context.js";
import { joinWorkspace } from "../join.js";
import { setWorkspaceCloud, workspaceCloud } from "../workspace-cloud.js";
import { fail, route } from "./router.js";

/**
 * The machine in the kraftwerk cloud (server/cloud.ts): its record, turning
 * it on or off, a round now, releasing the claim. What `kraftwerk cloud`,
 * `login` and `logout` ask the running daemon; a standalone server answers
 * "off" (only the daemon registers). This machine only: the claim code
 * claims the machine. And an invite to one served workspace (`kraftwerk
 * invite`): someone joins it as a remote member, without a clone.
 */
export const cloudRoutes = [
  route({ name: "cloud.status", method: "GET", path: "/api/cloud", summary: "the machine's cloud record: state, claim code, account, last heartbeat", access: "local" }, async () => ({
    daemon: currentHub().daemon === true,
    ...cloudStatus(),
  })),
  route(
    {
      name: "cloud.set",
      method: "POST",
      path: "/api/cloud",
      summary: "turn the machine's cloud on or off {enabled, url?} (~/.kraftwerk/cloud.json); off says goodbye",
      access: "local",
      body: z.object({ enabled: z.boolean(), url: z.string().url().optional() }),
    },
    async (c) => {
      const { enabled, url } = await c.body();
      await writeCloudFile({ enabled, url });
      return { daemon: currentHub().daemon === true, ...(await applyMachineCloud()) };
    },
  ),
  route({ name: "cloud.sync", method: "POST", path: "/api/cloud/sync", summary: "register or heartbeat now; answers the record (a claim made in the cloud shows here)", access: "local" }, async () => ({
    daemon: currentHub().daemon === true,
    ...(await syncMachineCloud()),
  })),
  route(
    {
      name: "cloud.invite",
      method: "POST",
      path: "/api/cloud/invite",
      summary: "an invite to a served workspace {slug | root, role?}: the cloud's join code and link (a claimed machine only)",
      access: "local",
      errors: 409,
      body: z.object({ slug: z.string().optional(), root: z.string().optional(), role: z.enum(["owner", "member"]).optional() }).refine((b) => b.slug || b.root, "name the workspace: slug or root"),
    },
    async (c) => {
      const { slug, root, role } = await c.body();
      return createWorkspaceInvite({ slug, root }, role);
    },
  ),
  // Start on the platform: `kraftwerk join <link>` (server/join.ts).
  route(
    {
      name: "cloud.join",
      method: "POST",
      path: "/api/cloud/join",
      summary: "bring a workspace from kraftwerk cloud onto this machine {link, dir?, cwd}: claim, clone from kraftwerk sync, open",
      access: "local",
      errors: 409,
      body: z.object({ link: z.string().min(1, "link is required"), dir: z.string().optional(), cwd: z.string().min(1, "cwd is required") }),
    },
    async (c) => {
      const { link, dir, cwd } = await c.body();
      return joinWorkspace(link, dir, cwd);
    },
  ),
  route({ name: "cloud.unlink", method: "POST", path: "/api/cloud/unlink", summary: "release the machine from its account; the cloud hands out a fresh claim code", access: "local", errors: 400 }, async () => ({
    daemon: currentHub().daemon === true,
    ...(await unlinkMachineCloud()),
  })),
  // This workspace's mode — local or cloud — as one switch (server/workspace-cloud.ts).
  route({ name: "workspace.cloud.get", method: "GET", path: "/api/workspace/cloud", summary: "this workspace's mode (local | cloud) and the steps cloud mode needs: machine on, claimed, workspace id, sign-in", access: "local" }, async () =>
    workspaceCloud(),
  ),
  route(
    {
      name: "workspace.cloud.set",
      method: "POST",
      path: "/api/workspace/cloud",
      summary: "switch this workspace to local or cloud {mode}; cloud does every step it can and answers next: \"claim\" while the browser has to claim the machine",
      access: "local",
      errors: 400,
      body: z.object({ mode: z.enum(["local", "cloud"]) }),
    },
    async (c) => {
      // In cloud mode only an owner switches the workspace back.
      if (c.trust.kind === "local" && c.trust.user && c.trust.user.role !== "owner") fail(403, "only an owner of the workspace switches its mode");
      return setWorkspaceCloud((await c.body()).mode);
    },
  ),
];
