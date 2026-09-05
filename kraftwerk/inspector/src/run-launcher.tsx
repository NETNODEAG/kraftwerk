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

/** Form state + launch for one workflow; the form and the dialog render it differently. */
export function useRunLauncher(slug: string, usesRequest: boolean, initialRequest?: string) {
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
      navigate(`/runs/${await launchRun(slug, { request: request.trim(), sandbox, ssh })}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return { request, setRequest, sandbox, setSandbox, ssh, setSsh, busy, error, docker, canRun, launch };
}

/** Inline launcher on the workflow page: request + button on one line, options below. */
export function RunForm({
  slug,
  usesRequest,
  initialRequest,
}: {
  slug: string;
  usesRequest: boolean;
  initialRequest?: string;
}) {
  const l = useRunLauncher(slug, usesRequest, initialRequest);
  return (
    <div className="run-launcher">
      <div className="run-form">
        {usesRequest ? (
          <input
            type="text"
            value={l.request}
            aria-label="request"
            placeholder="request — topic, URL, host …"
            onChange={(e) => l.setRequest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && l.launch()}
          />
        ) : (
          <span className="run-norequest">this workflow takes no request</span>
        )}
        <button className="run-btn" onClick={l.launch} disabled={!l.canRun}>
          {l.busy ? "starting…" : <><Icon name="play_arrow" className="ms-sm" /> {l.sandbox ? "run in sandbox" : "run locally"}</>}
        </button>
      </div>
      <div className="run-opts">
        <label>
          <input type="checkbox" checked={l.sandbox} onChange={(e) => l.setSandbox(e.target.checked)} />
          docker sandbox {sandboxHint(l.docker) && <span className="opt-hint">— {sandboxHint(l.docker)}</span>}
        </label>
        <label>
          <input type="checkbox" checked={l.ssh} onChange={(e) => l.setSsh(e.target.checked)} disabled={!l.sandbox} />
          forward SSH agent
        </label>
      </div>
      {l.error && <div className="gate-fail-msg">{l.error}</div>}
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
