import { useEffect, useState } from "react";
import { navigate, usePoll } from "./shared";
import { Button, Notice, SwitchRow, TextField } from "./ui";

/**
 * Triggering a workflow run from the browser — shared by the ▶ button on
 * the workflows list, the run dialog, and the workflow page. Sandbox is the
 * default whenever Docker and the runner image are there.
 */

export interface DockerStatus {
  available: boolean;
  image: boolean;
}

/** Docker daemon + runner image, polled slowly; the route ignores the slug. */
export function useDocker(): DockerStatus | null {
  return usePoll<DockerStatus>("/api/workflows/any/run", false, 15_000);
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
  const res = await fetch(`/api/workflows/${encodeURIComponent(slug)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
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
  const [sandbox, setSandbox] = useState(true);
  const [ssh, setSsh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docker = useDocker();

  useEffect(() => {
    if (!request && initialRequest) setRequest(initialRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest]);
  // No usable sandbox: start with the switch off so Run is not dead on arrival.
  useEffect(() => {
    if (docker && !sandboxReady(docker)) setSandbox(false);
  }, [docker]);

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
 * Inline launcher on the workflow page: the request field and Run on one
 * line so the page needs no heading over it — the field says what to type,
 * the switches under it say where it runs.
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
  return (
    <div className="flex flex-col gap-1 px-5 pt-4 pb-2">
      <div className="flex items-center gap-4 max-[700px]:flex-wrap">
        {usesRequest ? (
          <TextField
            className="h-11 min-w-0 flex-1 text-md"
            value={l.request}
            placeholder="Request"
            aria-label="request"
            onChange={(e) => l.setRequest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && l.launch()}
          />
        ) : (
          <span className="flex-1 text-base text-fg-2">This workflow takes no request.</span>
        )}
        <Button variant="primary" icon="play_arrow" className="h-11 px-5 max-[700px]:w-full" busy={l.busy} onClick={l.launch} disabled={!l.canRun}>
          {l.busy ? "Starting…" : "Run"}
        </Button>
      </div>
      <div className="-mx-2 mt-1 flex flex-wrap gap-x-2">
        <SwitchRow label="Docker sandbox" hint={sandboxHint(l.docker)} checked={l.sandbox} onChange={l.setSandbox} />
        {l.sandbox && <SwitchRow label="Forward SSH agent" hint="keys and known hosts from this machine" checked={l.ssh} onChange={l.setSsh} />}
      </div>
      {l.error && <Notice tone="bad">{l.error}</Notice>}
    </div>
  );
}

