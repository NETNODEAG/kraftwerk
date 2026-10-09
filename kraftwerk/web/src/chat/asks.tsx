/** Where the agent waits for you: the approval card for a permission request and the question card for an elicitation. */
import { useState } from "react";
import { api } from "../api";
import { Button, cn, TextField } from "../ui";
import { useSpeaker } from "./helpers";
import type { Block } from "./blocks";

/** The agent asked something: a small form built from the elicitation's fields. */
export function QuestionCard({ b, chatId }: { b: Extract<Block, { kind: "question" }>; chatId: string }) {
  const [values, setValues] = useState<Record<string, string | number | boolean | string[]>>({});
  const [sending, setSending] = useState(false);
  const speaker = useSpeaker();
  const [gone, setGone] = useState<string | null>(null);
  const pending = b.resolved === undefined && !gone;

  async function answer(action: "accept" | "decline") {
    setSending(true);
    try {
      const r = await api.request("chats.elicitation", {
        id: chatId,
        body: { requestId: b.requestId, action, ...(action === "accept" ? { content: values } : {}) },
      });
      if (!r.ok) setGone(r.error ?? `request failed (${r.status})`);
    } catch {
      /* offline: the form stays */
    }
    setSending(false);
  }
  const set = (key: string, v: string | number | boolean | string[]) => setValues((prev) => ({ ...prev, [key]: v }));
  const missing = b.fields.some((f) => f.required && (values[f.key] === undefined || values[f.key] === ""));

  return (
    <Ask className={cn("question-card", pending && "pending")} requestId={b.requestId} who={`${speaker(b.from)} asks`} what={b.message}>
      {pending ? (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {b.fields.map((f) => (
            <label key={f.key} className={cn("flex flex-col gap-1.5 text-sm", f.custom && "-mt-1")}>
              {(f.title || f.description) && !f.custom && (
                <span>
                  {f.title && <b>{f.title}</b>}
                  {f.description && <span className="opacity-85"> {f.description}</span>}
                </span>
              )}
              {f.kind === "select" && (
                <div className="flex flex-wrap gap-1.5">
                  {f.options?.map((o) => (
                    <Button key={o.value} size="sm" variant={values[f.key] === o.value ? "primary" : "secondary"} title={o.description} onClick={() => set(f.key, o.value)}>
                      {o.label}
                    </Button>
                  ))}
                </div>
              )}
              {f.kind === "multiselect" && (
                <div className="flex flex-wrap gap-1.5">
                  {f.options?.map((o) => {
                    const cur = (values[f.key] as string[] | undefined) ?? [];
                    const on = cur.includes(o.value);
                    return (
                      <Button key={o.value} size="sm" variant={on ? "primary" : "secondary"} title={o.description} onClick={() => set(f.key, on ? cur.filter((v) => v !== o.value) : [...cur, o.value])}>
                        {o.label}
                      </Button>
                    );
                  })}
                </div>
              )}
              {f.kind === "text" && (
                <TextField
                  className="max-w-[60ch]"
                  placeholder={f.custom ? "or type your own answer" : (f.title ?? f.key)}
                  value={(values[f.key] as string | undefined) ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {f.kind === "number" && (
                <TextField
                  type="number"
                  className="max-w-[60ch]"
                  value={(values[f.key] as number | undefined) ?? ""}
                  onChange={(e) => set(f.key, e.target.value === "" ? "" : Number(e.target.value))}
                />
              )}
              {f.kind === "boolean" && (
                <span>
                  <input type="checkbox" className="accent-accent" checked={values[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} /> {f.title ?? f.key}
                </span>
              )}
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={sending || missing} onClick={() => answer("accept")}>
              answer
            </Button>
            <Button disabled={sending} onClick={() => answer("decline")}>
              skip
            </Button>
          </div>
        </div>
      ) : (
        <Resolved>
          {gone
            ? `→ ${gone}`
            : b.resolved?.action === "accept"
              ? `→ ${Object.values(b.resolved.content ?? {})
                  .filter((v) => v !== "" && v !== undefined && !(Array.isArray(v) && v.length === 0))
                  .map((v) => (Array.isArray(v) ? v.join(", ") : String(v)))
                  .join(" · ") || "answered"}`
              : b.resolved?.action === "decline"
                ? "→ skipped"
                : "→ dismissed"}
        </Resolved>
      )}
    </Ask>
  );
}

/**
 * The agent stopped for you: an approval or a question, read as a sentence
 * (who asks, then what). `perm-card`, `pending` and `data-request` are what
 * "next" finds and lights up (attention.tsx).
 */
function Ask({ className, requestId, who, what, children }: { className?: string; requestId: string; who: string; what: string; children: React.ReactNode }) {
  return (
    <div className={cn("perm-card max-w-[76ch] self-start rounded-2xl bg-ask-soft px-4 py-3 text-on-ask-soft", className)} data-request={requestId}>
      <div className="flex flex-col gap-[3px]">
        <span className="perm-who text-[12.5px] font-semibold text-fg-2">{who}</span>
        <span className="text-base font-semibold [overflow-wrap:anywhere] text-fg">{what}</span>
      </div>
      {children}
    </div>
  );
}

function Resolved({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 font-mono text-xs text-fg-2">{children}</div>;
}

export function PermissionCard({
  b,
  chatId,
}: {
  b: Extract<Block, { kind: "permission" }>;
  chatId: string;
}) {
  const [sending, setSending] = useState(false);
  const speaker = useSpeaker();
  // The server no longer holds this request (answered elsewhere, or the
  // agent is gone): say so instead of leaving buttons that do nothing.
  const [gone, setGone] = useState<string | null>(null);
  const pending = b.resolved === undefined && !gone;

  async function answer(optionId: string | null) {
    setSending(true);
    try {
      const r = await api.request("chats.permission", { id: chatId, body: { requestId: b.requestId, optionId } });
      if (!r.ok) setGone(r.error ?? `request failed (${r.status})`);
    } catch {
      /* offline: the buttons stay, the next click retries */
    }
    setSending(false);
  }

  return (
    <Ask className={cn(pending && "pending")} requestId={b.requestId} who={`${speaker(b.from)} asks for your OK`} what={b.title}>
      {pending ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {b.options.map((o) => (
            <Button key={o.optionId} variant={o.kind?.startsWith("allow") ? "primary" : "secondary"} disabled={sending} title={o.name} onClick={() => answer(o.optionId)}>
              {optionLabel(o)}
            </Button>
          ))}
        </div>
      ) : (
        <Resolved>
          {b.resolved
            ? `→ ${(() => {
                const o = b.options.find((x) => x.optionId === b.resolved);
                return o ? optionLabel(o) : b.resolved;
              })()}`
            : gone
              ? `→ ${gone}`
              : "→ dismissed"}
        </Resolved>
      )}
    </Ask>
  );
}

/** A permission option in plain words, by its kind; the adapter's own name stays as the tooltip. */
function optionLabel(o: { name: string; kind?: string }): string {
  if (o.kind === "allow_once") return "Allow";
  if (o.kind === "allow_always") return "Always allow";
  if (o.kind === "reject_once") return "Don't allow";
  if (o.kind === "reject_always") return "Never allow";
  return o.name;
}
