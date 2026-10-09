import * as z from "zod";
import { agentStatuses } from "../../core/agent-status.js";
import { listAttention } from "../../core/attention.js";
import { startDiagnosis } from "../../core/diagnose.js";
import { clearNotifications, listNotifications, markNotificationsRead } from "../../core/notifications.js";
import { ApiError, route } from "./router.js";

/** What needs a person: the bell, the attention list, the rail's per-agent status. */
export const attentionRoutes = [
  route({ name: "notifications.list", method: "GET", path: "/api/notifications", summary: "the bell: attention items, newest first, plus the unread count" }, async () =>
    listNotifications(),
  ),
  route({ name: "notifications.clear", method: "DELETE", path: "/api/notifications", summary: "clear the list" }, async () => {
    await clearNotifications();
    return { ok: true };
  }),
  route({ name: "notifications.read", method: "POST", path: "/api/notifications/read", summary: "mark some {ids?} or all read", body: z.object({ ids: z.array(z.string()).optional() }) }, async (c) =>
    markNotificationsRead((await c.body()).ids ?? "all"),
  ),
  route({ name: "notifications.diagnose", method: "POST", path: "/api/notifications/:id/diagnose", summary: "open a chat that investigates the failure behind an item" }, async (c) => {
    const result = await startDiagnosis(c.params.id);
    if ("error" in result) throw new ApiError(result.status, result.error, result);
    return result;
  }),

  route({ name: "attention.list", method: "GET", path: "/api/attention", summary: "waiting approvals and questions, unread failures, with their owner" }, async () =>
    listAttention(),
  ),
  route({ name: "agents.status", method: "GET", path: "/api/agent-status", summary: "per agent: waiting, working, next routine, last active" }, async () =>
    agentStatuses(),
  ),
];
