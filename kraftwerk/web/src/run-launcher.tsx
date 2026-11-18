import { useEffect, useState } from "react";
import { api, useApi } from "./api";
import { Icon, navigate } from "./shared";
import { Notice, SwitchTrack } from "./ui";

/**
 * Triggering a workflow run from the browser — shared by the ▶ button on
 * the workflows list, the run dialog, and the workflow page. A run starts on
 * this machine unless the Docker sandbox is switched on (as `--sandbox` on the CLI).
 */

export interface DockerStatus {
  available: boolean;
  image: boolean;
}

/** Docker daemon + runner image, polled slowly; the route ignores the slug. */
export function useDocker(): DockerStatus | null {
  return useApi("workflows.runner", { slug: "any" }, { interval: 15_000 });
}

export const sandboxReady = (d: DockerStatus | null): boolean => !!d?.available && !!d?.image;

export function sandboxHint(d: DockerStatus | null): string {
  if (!d) return "";
  if (!d.available) return "Docker is not running";
  if (!d.image) return "image missing — run `kraftwerk runner build`";
  return "isolated container per run";
}

export async function launchRun(
  slug: string,
  opts: { request: string; sandbox: boolean; ssh: boolean }
): Promise<string> {
  const data = await api.call("workflows.run", { slug, body: opts });
  return data.runId as string;
}

/**
 * Form state + launch for one workflow; the form and the dialog render it
 * differently. Without `onLaunched` a successful launch opens the run's
 * page; with it the caller decides (the workflow overview stays put and
 * lets the new card show up on the board).
 */
export function useRunLauncher(
  slug: string,
  usesRequest: boolean,
  initialRequest?: string,
  onLaunched?: (runId: string) => void
) {
  const [request, setRequest] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [ssh, setSsh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docker = useDocker();

  useEffect(() => {
    if (!request && initialRequest) setRequest(initialRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest]);

  const canRun = !busy && (!usesRequest || !!request.trim()) && (!sandbox || sandboxReady(docker));

  async function launch() {
    if (!canRun) return;
    setBusy(true);
    setError(null);
    try {
      const runId = await launchRun(slug, { request: request.trim(), sandbox, ssh });
      if (onLaunched) {
        onLaunched(runId);
        setBusy(false);
      } else {
        navigate(`/runs/${runId}`);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return { request, setRequest, sandbox, setSandbox, ssh, setSsh, busy, error, docker, canRun, launch };
}

/**
 * The launcher of a workflow, drawn as a chat window like a skill's: the
 * workflow's name where the message starts, the request beside it, and
 * under them where it runs and the send button. Enter starts the run.
 */
export function RunForm({
  slug,
  usesRequest,
  initialRequest,
  onLaunched,
}: {
  slug: string;
  usesRequest: boolean;
  initialRequest?: string;
  onLaunched?: (runId: string) => void;
}) {
  const l = useRunLauncher(slug, usesRequest, initialRequest, onLaunched);
  const hint = sandboxHint(l.docker);
  return (
    <section className="run-form flex flex-col gap-2" aria-label={`run ${slug}`}>
      <div className="rounded-[18px] border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_16px_rgb(0_0_0/0.04)] focus-within:border-line-strong">
        <div className="flex items-start gap-2 px-4 pt-3.5 pb-1">
          <code className="mt-px inline-flex flex-none items-center gap-1 rounded-control bg-accent-soft px-2 py-0.5 text-sm font-medium text-on-accent-soft" title="the workflow this starts">
            <Icon name="account_tree" className="ms-sm" /> {slug}
          </code>
          {usesRequest ? (
            <textarea
              rows={2}
              value={l.request}
              aria-label="request"
              placeholder="Request"
              className="block max-h-[40vh] min-h-[48px] w-full resize-none border-0 bg-transparent p-0 font-[inherit] text-base text-fg shadow-none outline-none focus:shadow-none focus:outline-none focus-visible:outline-none placeholder:text-fg-2 [field-sizing:content]"
              onChange={(e) => l.setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void l.launch();
                }
              }}
            />
          ) : (
            <span className="min-h-[48px] flex-1 text-base text-fg-2">This workflow takes no request.</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-2.5 pb-2.5">
          <Where label="Docker sandbox" hint={hint} checked={l.sandbox} onChange={l.setSandbox} />
          {l.sandbox && <Where label="Forward SSH agent" hint="keys and known hosts from this machine" checked={l.ssh} onChange={l.setSsh} />}
          <span className="flex-1" />
          <span className="truncate text-xs text-fg-2 max-[800px]:hidden">{l.sandbox ? hint : "runs on this machine"}</span>
          <button
            type="button"
            aria-label="Run"
            title={l.busy ? "Starting…" : "Run (Enter)"}
            className="inline-grid size-8 flex-none cursor-pointer place-items-center rounded-full bg-accent text-on-accent transition-[filter] hover:enabled:brightness-110 disabled:cursor-default disabled:opacity-60"
            disabled={!l.canRun}
            onClick={() => void l.launch()}
          >
            <Icon name={l.busy ? "progress_activity" : "play_arrow"} className="ms-sm" />
          </button>
        </div>
      </div>
      {l.error && <Notice tone="bad">{l.error}</Notice>}
    </section>
  );
}

/** A switch of the launcher's bottom line: small, its hint in the tooltip. */
function Where({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-2.5 py-1 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
      onClick={() => onChange(!checked)}
    >
      <span className="-mx-1.5 inline-flex scale-[0.7]"><SwitchTrack checked={checked} /></span>
      {label}
    </button>
  );
}
