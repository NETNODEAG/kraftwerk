import { useEffect, useState } from "react";
import { api, useApi } from "./api";
import { Icon, navigate } from "./shared";
import { SwitchTrack } from "./ui";
import { ChatCard, useOpen } from "./chat-card";

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
  const open = useOpen();
  // Started from a page that can show the run beside it (Home's preview): it opens there.
  const l = useRunLauncher(slug, usesRequest, initialRequest, onLaunched ?? ((runId) => open(`/runs/${runId}`)));
  const hint = sandboxHint(l.docker);
  return (
    <ChatCard
      label={`run ${slug}`}
      className="run-form"
      chip={
        <>
          <Icon name="account_tree" className="ms-sm" /> {slug}
        </>
      }
      chipTitle="the workflow this starts"
      value={l.request}
      onChange={l.setRequest}
      inputLabel="request"
      placeholder="Request"
      noInput={usesRequest ? undefined : "This workflow takes no request."}
      onSend={() => void l.launch()}
      sendLabel="Run"
      sendIcon="play_arrow"
      busy={l.busy}
      disabled={!l.canRun}
      error={l.error}
      controls={
        <>
          <Where label="Docker sandbox" hint={hint} checked={l.sandbox} onChange={l.setSandbox} />
          {l.sandbox && <Where label="Forward SSH agent" hint="keys and known hosts from this machine" checked={l.ssh} onChange={l.setSsh} />}
        </>
      }
      hint={l.sandbox ? hint : "runs on this machine"}
    />
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
