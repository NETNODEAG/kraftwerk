import { useState } from "react";
import { api, ApiRequestError, useApi, type ApiResult } from "./api";
import { fmtAgo, Icon } from "./shared";
import { Button, EmptyState, Hint, Notice, Page, PageHeader, Panel, Select, Tag, TextField } from "./ui";

type Harness = ApiResult<"harnesses.list">["harnesses"][number];
type Kind = Harness["accepts"][number]["kind"];
type Scope = NonNullable<Harness["credential"]>["scope"];

const SCOPE: Record<Scope, string> = { workspace: "this workspace", machine: "every workspace on this machine" };
const KIND: Record<Kind, string> = { api_key: "API key", subscription_token: "subscription token" };

/** What a harness will sign in with, in one line — and whether that is a problem. */
function signIn(h: Harness): { tone: "ok" | "neutral" | "bad"; text: string } {
  if (h.credential) return { tone: "ok", text: `${KIND[h.credential.kind]} ending in ${h.credential.ending}, for ${SCOPE[h.credential.scope]}` };
  if (h.env.length) return { tone: "ok", text: `${h.env.join(", ")} from the shell or the workspace's .env` };
  if (h.login === "present") return { tone: "ok", text: "its own login on this machine" };
  if (h.login === "absent") return { tone: "bad", text: "nothing: no key, no token, and its CLI is not logged in here" };
  return { tone: "neutral", text: "its own login on this machine, if there is one — a chat on it says who" };
}

/**
 * The harnesses agents run on, on one page (#/settings/harnesses): which
 * can be used on this machine and what each signs in with — an API key, a
 * subscription's token, or the CLI's own login. A key entered here stays
 * on this machine (never in the workspace's files) and is shown by its
 * last four characters only.
 */
export function HarnessesAdmin() {
  const [refresh, setRefresh] = useState(0);
  const data = useApi("harnesses.list", {}, { interval: 15_000, refresh });
  const all = data?.harnesses ?? [];
  const usable = all.filter((h) => h.available).length;

  return (
    <Page className="max-w-[860px] px-6 py-6">
      <PageHeader
        icon={<Icon name="key" className="text-[28px] text-fg-2" />}
        title="Harnesses"
        sub={data ? `${usable} of ${all.length} usable here · keys stay on this machine` : undefined}
      />
      {!data ? (
        <Panel>
          <EmptyState>loading…</EmptyState>
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {all.map((h) => (
            <HarnessCard key={h.id} h={h} onChanged={() => setRefresh((n) => n + 1)} />
          ))}
        </div>
      )}
    </Page>
  );
}

function HarnessCard({ h, onChanged }: { h: Harness; onChanged: () => void }) {
  const s = signIn(h);
  return (
    <Panel
      title={h.label}
      actions={
        <>
          {h.adapter && <Tag title="its adapter comes with kraftwerk: chats and agents with protocol: acp">bundled {h.adapter.version}</Tag>}
          {h.cli && <Tag title={h.cli.path}>{h.cli.command} on the PATH</Tag>}
          {!h.available && <Tag tone="bad">not installed</Tag>}
        </>
      }
    >
      <div className="flex flex-col gap-3 px-[18px] py-3.5" data-harness={h.id}>
        {!h.available && (
          <Notice tone="bad">
            Not usable on this machine: install its CLI (<code>{h.needs}</code>) and log in with it.
          </Notice>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-2xs tracking-[0.5px] text-fg-2 uppercase">signs in with</span>
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <Tag tone={s.tone}>{h.credential ? KIND[h.credential.kind] : h.env.length ? "environment" : h.login === "absent" ? "not signed in" : "CLI login"}</Tag>
            <span>{s.text}</span>
            {h.credential && <span className="text-fg-2">· set {fmtAgo(new Date(h.credential.setAt).toISOString())}</span>}
          </span>
          {h.seen && (
            <span className="text-xs text-fg-2">
              Last chat ({fmtAgo(new Date(h.seen.at).toISOString())}): {h.seen.kind === "none" ? "not signed in" : [h.seen.email ?? h.seen.label, h.seen.organization, h.seen.plan].filter(Boolean).join(" · ")}
              {h.seen.detail ? ` — ${h.seen.detail}` : ""}
            </span>
          )}
        </div>
        {h.accepts.length > 0 ? <CredentialForm h={h} onChanged={onChanged} /> : <Hint>It signs in with its own CLI only; there is nothing to store for it here.</Hint>}
      </div>
    </Panel>
  );
}

function CredentialForm({ h, onChanged }: { h: Harness; onChanged: () => void }) {
  const [kind, setKind] = useState<Kind>(h.credential?.kind ?? h.accepts[0].kind);
  const [scope, setScope] = useState<Scope>(h.credential?.scope ?? "workspace");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const spec = h.accepts.find((a) => a.kind === kind) ?? h.accepts[0];

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await fn();
      setValue("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) void run(() => api.call("harnesses.setCredential", { id: h.id, body: { kind, value, scope } }));
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {h.accepts.length > 1 && (
          <Select aria-label="what to store" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-auto">
            {h.accepts.map((a) => (
              <option key={a.kind} value={a.kind}>{a.label}</option>
            ))}
          </Select>
        )}
        <TextField
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={`${spec.label} for ${h.label}`}
          placeholder={h.credential ? "paste a new one" : `paste the ${spec.label}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-[220px] flex-1 font-mono"
        />
        <Select aria-label="where it applies" value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="w-auto">
          <option value="workspace">this workspace</option>
          <option value="machine">every workspace here</option>
        </Select>
        <Button variant="primary" type="submit" disabled={busy || !value.trim()}>{h.credential ? "replace" : "save"}</Button>
        {h.credential && (
          <Button
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.call("harnesses.removeCredential", { id: h.id, query: { scope: h.credential!.scope } }))}
            title={`forget the ${KIND[h.credential.kind]} stored for ${SCOPE[h.credential.scope]}`}
          >
            remove
          </Button>
        )}
      </div>
      <Hint>{spec.hint} It is kept on this machine, outside the workspace's files, and used by the next chat or run.</Hint>
      {error && <Notice tone="bad">{error}</Notice>}
    </form>
  );
}
