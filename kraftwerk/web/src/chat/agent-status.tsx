/** The chat header's agent chips: sign-in trouble, context use and cost, and the model and thinking settings. */
import { useState } from "react";
import type { ConfigOption } from "../types";
import { api } from "../api";
import { Icon, useExpertMode } from "../shared";
import { Select, Tag } from "../ui";
import type { liveState } from "./helpers";

/** Header chips: signed-in identity, context window and cost, and the settings the agent lets us change. */
export function AgentStatus({ id, live }: { id: string; live: ReturnType<typeof liveState> }) {
  const expert = useExpertMode();
  const [busyId, setBusyId] = useState<string | null>(null);
  const shown = live.config.filter((o) => o.category === "model" || o.category === "thought_level");
  async function change(o: ConfigOption, value: string | boolean) {
    setBusyId(o.id);
    const r = await api.request("chats.config", { id, body: { configId: o.id, value } }).catch(() => null);
    setBusyId(null);
    if (r && !r.ok) alert(r.error ?? `setting refused (${r.status})`);
  }
  return (
    <>
      {/* Signed in, the account is named in the composer's tooltip; signed out, it is a problem worth the space. */}
      {live.auth?.kind === "none" && (
        <span title={[live.auth.detail, live.auth.email, live.auth.organization, live.auth.plan].filter(Boolean).join(" · ")}>
          <Tag tone={live.auth.kind === "none" ? "bad" : "neutral"}>
            <Icon name={live.auth.kind === "none" ? "person_off" : "person"} className="ms-sm mr-1" /> {live.auth.email ?? live.auth.label}
          </Tag>
        </span>
      )}
      {expert && live.usage && live.usage.size > 0 && (
        <span className="font-mono" title={`${live.usage.used.toLocaleString()} of ${live.usage.size.toLocaleString()} context tokens${live.usage.costUsd != null ? ` · $${live.usage.costUsd.toFixed(2)} so far` : ""}`}>
          <Tag>
            {Math.round((100 * live.usage.used) / live.usage.size)}% ctx
            {live.usage.costUsd != null && ` · $${live.usage.costUsd.toFixed(2)}`}
          </Tag>
        </span>
      )}
      {expert &&
        shown.map((o) =>
          o.type === "select" ? (
            <Select
              key={o.id}
              className="h-7 w-auto max-w-[22ch] px-2 pr-6 text-xs text-fg-2"
              value={o.value}
              disabled={busyId === o.id}
              title={o.description ?? o.name}
              aria-label={o.name}
              onChange={(e) => change(o, e.target.value)}
            >
              {o.choices.map((c) => (
                <option key={c.value} value={c.value} title={c.description}>
                  {c.group ? `${c.group} · ` : ""}{c.name}
                </option>
              ))}
            </Select>
          ) : (
            <label key={o.id} className="inline-flex cursor-pointer items-center gap-1 text-xs text-fg-2" title={o.description ?? o.name}>
              <input type="checkbox" className="accent-accent" checked={o.value} disabled={busyId === o.id} onChange={(e) => change(o, e.target.checked)} /> {o.name}
            </label>
          )
        )}
    </>
  );
}
