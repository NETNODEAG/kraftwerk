import { useEffect, useState } from "react";
import { Icon, navigate, usePoll } from "./shared";

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
 * Inline launcher on the workflow page. The same M3 parts as the dialog —
 * filled text field, filled button, switch list items — laid out on one
 * line so the page needs no heading over it: the field says what to type,
 * the switches say where it runs.
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
    <div className="run-launcher">
      <div className="run-launcher-main">
        {usesRequest ? (
          <label className="m3-field">
            <input
              type="text"
              value={l.request}
              placeholder=" "
              aria-label="request"
              onChange={(e) => l.setRequest(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && l.launch()}
            />
            <span className="m3-field-label">Request</span>
          </label>
        ) : (
          <span className="run-norequest">This workflow takes no request.</span>
        )}
        <button className="m3-filled-btn run-go" onClick={l.launch} disabled={!l.canRun}>
          <Icon name="play_arrow" /> {l.busy ? "Starting…" : "Run"}
        </button>
      </div>
      <div className="m3-switches run-switches">
        <SwitchRow label="Docker sandbox" hint={sandboxHint(l.docker)} checked={l.sandbox} onChange={l.setSandbox} />
        {l.sandbox && <SwitchRow label="Forward SSH agent" hint="keys and known hosts from this machine" checked={l.ssh} onChange={l.setSsh} />}
      </div>
      {l.error && <div className="m3-error">{l.error}</div>}
    </div>
  );
}

/** M3 switch: a list-item row with headline, optional supporting text, and the toggle. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button type="button" className="m3-switch-row" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="m3-switch-text">
        <span className="m3-switch-label">{label}</span>
        {hint && <span className="m3-switch-hint">{hint}</span>}
      </span>
      <span className={`m3-switch ${checked ? "on" : ""}`} aria-hidden>
        <span className="m3-switch-knob" />
      </span>
    </button>
  );
}
