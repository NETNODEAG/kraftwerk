import { useEffect, useState, type ReactNode } from "react";
import { api, useApi, type ApiResult } from "./api";
import { CloudPanel } from "./settings";
import { Icon } from "./shared";
import {
  Button,
  buttonClass,
  cn,
  Hint,
  Page,
  PageHeader,
  Panel,
  Popover,
} from "./ui";

/**
 * Local or cloud — a workspace's mode as one switch (server/workspace-cloud.ts).
 *
 * Local is where everyone starts: no account, everything in files on this
 * machine. Cloud is always one click away — the chip in the top bar says
 * which mode the workspace is in and opens the switch; #/settings/cloud
 * explains the difference and walks through what cloud mode needs.
 */

type WorkspaceCloud = ApiResult<"workspace.cloud.get">;

export const CLOUD_PAGE = "#/settings/cloud";

/**
 * The workspace's mode, one copy for the whole page: the chip, the settings
 * panel and the cloud page read the same state and share one poll (15 s,
 * every 2 s while a switch waits for the machine or the claim). null for a
 * caller the route refuses (a paired device, a member) or before the first
 * answer.
 */
interface CloudState {
  cloud: WorkspaceCloud | null;
  busy: boolean;
  /** Switching to cloud, waiting for the machine to connect or the claim. */
  waiting: boolean;
  error: string;
}

let state: CloudState = { cloud: null, busy: false, waiting: false, error: "" };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let waitUntil = 0;
/** The mode last asked for: an answer to an older switch does not undo a newer one. */
let intent: "local" | "cloud" | null = null;

const set = (patch: Partial<CloudState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

async function load(): Promise<void> {
  const r = await api.request("workspace.cloud.get", {});
  if (r.ok) set({ cloud: r.data as WorkspaceCloud });
}

/** The next poll: a switch that waits asks again (and finishes), otherwise the mode is read. */
function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!listeners.size) return;
  timer = setTimeout(async () => {
    if (state.waiting && Date.now() < waitUntil) await step("cloud");
    else {
      if (state.waiting) set({ waiting: false });
      await load();
    }
    schedule();
  }, state.waiting ? 2_000 : 15_000);
}

/** One switch request; to cloud it waits while the machine connects or the claim is pending. */
async function step(mode: "local" | "cloud"): Promise<void> {
  const r = await api.request("workspace.cloud.set", { body: { mode } });
  if (!r.ok) return set({ error: r.error ?? `HTTP ${r.status}`, waiting: false });
  const c = r.data as WorkspaceCloud;
  // Local chosen meanwhile wins: a late answer to cloud neither restarts the wait nor reloads.
  if (mode !== intent) return;
  const wait = mode === "cloud" && c.mode !== "cloud" && (c.next === "connect" || c.next === "claim");
  set({ cloud: c, waiting: wait, error: "" });
  // Cloud mode on: this browser signs in next — the server sends it there.
  if (mode === "cloud" && c.mode === "cloud") setTimeout(() => location.reload(), 900);
}

async function switchTo(mode: "local" | "cloud"): Promise<void> {
  // Local stops a pending switch to cloud at once.
  intent = mode;
  set({ busy: true, error: "", waiting: false });
  if (mode === "cloud") waitUntil = Date.now() + 600_000;
  await step(mode);
  set({ busy: false });
  schedule();
}

/** This workspace's mode and the switch, shared by every component that shows it. */
export function useWorkspaceCloud() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (listeners.size === 1) void load().then(schedule);
    return () => {
      listeners.delete(l);
      if (!listeners.size && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
  return { ...state, to: switchTo };
}

/** What each mode gives — the explanation beside the switch. */
const MODES: Record<
  "local" | "cloud",
  { icon: string; title: string; tagline: string; points: string[] }
> = {
  local: {
    icon: "laptop_mac",
    title: "Local",
    tagline: "Just you, on this machine. No account.",
    points: [
      "Everything lives in files in this folder — boards, projects, knowledge, chats",
      "Agents run here, on your subscriptions and keys",
      "Tasks go to agents or to you",
      "Your work stays on this machine — only minimal usage info goes out (off in kraftwerk.yml)",
    ],
  },
  cloud: {
    icon: "cloud",
    title: "Cloud",
    tagline: "Multiplayer, and reachable from anywhere.",
    points: [
      "Sign in with your kraftwerk cloud account — every change is signed by its person",
      "Cloud boards: shared with everyone on the workspace, tasks for people and agents",
      "Invite teammates as members — no clone, no install",
      "Reach your workspaces from another computer or your phone",
    ],
  },
};

const STEPS: {
  key: keyof WorkspaceCloud["steps"];
  label: string;
  done: string;
  todo: string;
}[] = [
  {
    key: "machine",
    label: "Connect this machine",
    done: "connected to kraftwerk cloud",
    todo: "the daemon registers this machine with kraftwerk cloud",
  },
  {
    key: "claim",
    label: "Claim it with your account",
    done: "claimed",
    todo: "sign in (or sign up) in the browser — once per machine",
  },
  {
    key: "workspace",
    label: "Register this workspace",
    done: "known to the cloud by its id",
    todo: "kraftwerk.yml gets the workspace's id (commit it)",
  },
  {
    key: "signin",
    label: "Sign in here",
    done: "people sign in with their cloud account",
    todo: "this page asks you to sign in with the account",
  },
];

/** Local | Cloud as a segmented control. */
function ModeToggle({
  mode,
  busy,
  onPick,
}: {
  mode: "local" | "cloud";
  busy: boolean;
  onPick: (m: "local" | "cloud") => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="workspace mode"
      className="inline-flex rounded-full border border-line bg-surface-2 p-0.5"
    >
      {(["local", "cloud"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          disabled={busy}
          onClick={() => mode !== m && onPick(m)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 px-3.5 py-1.5 font-[inherit] text-sm font-semibold transition-colors disabled:cursor-default",
            mode === m
              ? m === "cloud"
                ? "bg-accent text-on-accent"
                : "bg-surface text-fg shadow-[0_0_0_1px_var(--line)]"
              : "bg-transparent text-fg-2 hover:text-fg",
          )}
        >
          <Icon name={MODES[m].icon} className="ms-sm" />
          {MODES[m].title}
        </button>
      ))}
    </div>
  );
}

/** The steps cloud mode needs, ticked off; the claim with its link and code while it waits. */
function Steps({
  cloud,
  waiting,
}: {
  cloud: WorkspaceCloud;
  waiting: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const current = STEPS.find((s) => !cloud.steps[s.key])?.key;
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
      {STEPS.map((s, i) => {
        const ok = cloud.steps[s.key];
        const here = s.key === current;
        return (
          <li key={s.key} className="flex gap-3">
            <span
              className={cn(
                "grid size-6 flex-none place-items-center rounded-full text-xs font-bold",
                ok
                  ? "bg-ok text-on-accent"
                  : here
                    ? "bg-accent/15 text-accent ring-1 ring-accent"
                    : "bg-surface-2 text-fg-2",
              )}
            >
              {ok ? <Icon name="check" className="text-[15px]" /> : i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span
                className={cn(
                  "text-sm font-semibold",
                  !ok && !here && "text-fg-2",
                )}
              >
                {s.label}
              </span>
              <span className="text-xs text-fg-2">{ok ? s.done : s.todo}</span>
              {here && s.key === "machine" && cloud.next === "connect" && (
                <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-fg-2">
                  <span className="size-2 animate-pulse rounded-full bg-accent" /> connecting …
                </span>
              )}
              {here &&
                s.key === "claim" &&
                cloud.next === "claim" &&
                cloud.claimUrl && (
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <a
                      className={buttonClass("primary", "sm")}
                      href={cloud.claimUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="open_in_new" className="ms-sm" /> sign in
                      &amp; claim
                    </a>
                    {cloud.claimCode && (
                      <button
                        type="button"
                        title="copy the claim code"
                        onClick={() => {
                          void navigator.clipboard.writeText(cloud.claimCode!);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                        className="cursor-pointer rounded-control border border-line bg-surface-2 px-2.5 py-1 font-mono text-sm tracking-[0.12em] text-fg"
                      >
                        {copied ? "copied" : cloud.claimCode}
                      </button>
                    )}
                    {waiting && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-fg-2">
                        <span className="size-2 animate-pulse rounded-full bg-accent" />{" "}
                        waiting for the claim …
                      </span>
                    )}
                  </span>
                )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Problem({ cloud, error }: { cloud: WorkspaceCloud; error: string }) {
  const text = error || cloud.problem;
  if (!text) return null;
  return (
    <p className="m-0 flex items-start gap-1.5 rounded-control bg-bad/8 px-3 py-2 text-xs text-bad">
      <Icon name="error" className="ms-sm" />
      <span>{text}</span>
    </p>
  );
}

/** The two modes side by side: what each gives, the current one marked. */
export function ModeCompare({ mode }: { mode?: "local" | "cloud" }) {
  return (
    <div className="grid gap-3 min-[720px]:grid-cols-2">
      {(["local", "cloud"] as const).map((m) => (
        <div
          key={m}
          className={cn(
            "flex flex-col gap-2 rounded-card border p-4",
            mode === m
              ? m === "cloud"
                ? "border-accent bg-accent/5"
                : "border-fg/30 bg-surface"
              : "border-line bg-surface",
          )}
        >
          <div className="flex items-center gap-2">
            <Icon
              name={MODES[m].icon}
              className={cn(
                "text-[22px]",
                m === "cloud" ? "text-accent" : "text-fg-2",
              )}
            />
            <span className="font-semibold">{MODES[m].title}</span>
            {mode === m && (
              <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-semibold text-fg-2">
                this workspace
              </span>
            )}
          </div>
          <span className="text-sm text-fg-2">{MODES[m].tagline}</span>
          <ul className="m-0 flex flex-col gap-1.5 pl-0">
            {MODES[m].points.map((p) => (
              <li key={p} className="flex list-none gap-2 text-sm">
                <Icon
                  name="check"
                  className={cn(
                    "ms-sm mt-px",
                    m === "cloud" ? "text-accent" : "text-fg-2",
                  )}
                />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The mode in the top bar: always visible, one click from the switch. Nothing for a member or a server without the route. */
export function ModeChip() {
  const me = useApi("me.get", {}, { interval: 60_000 });
  const sw = useWorkspaceCloud();
  const { cloud } = sw;
  if (!cloud || me?.via === "member") return null;
  const isCloud = cloud.mode === "cloud";
  const offline = isCloud && cloud.state !== "connected";
  // In cloud mode the workspace's page in the cloud is one click away, beside the chip.
  const cloudLink = isCloud && cloud.workspaceUrl && !cloud.deleted ? cloud.workspaceUrl : null;
  return (
    <span className="inline-flex flex-none items-center gap-1">
      <Popover
        align="end"
        className="w-[min(380px,calc(100vw-24px))] p-0"
        trigger={({ toggle, open }) => (
          <button
            type="button"
            // mode-chip: the tests find it by this name.
            className={cn(
              "mode-chip inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-[inherit] text-xs font-semibold transition-colors",
              isCloud && cloud.deleted
                ? "border-bad/40 bg-bad/10 text-bad hover:bg-bad/18"
                : isCloud
                  ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/18"
                  : "border-line bg-transparent text-fg-2 hover:text-fg",
              open && "ring-2 ring-accent/30",
            )}
            aria-label={`workspace mode: ${cloud.mode}`}
            title={
              isCloud
                ? cloud.deleted
                  ? "Deleted in kraftwerk cloud — switch to local to keep working"
                  : offline
                  ? "Cloud mode — the cloud does not answer right now"
                  : "Cloud mode — multiplayer"
                : "Local mode — switch to cloud for multiplayer"
            }
            onClick={toggle}
          >
            <Icon
              name={isCloud ? (offline ? "cloud_off" : "cloud") : "laptop_mac"}
              className="ms-sm"
            />
            <span className="max-[640px]:hidden">
              {isCloud ? (cloud.deleted ? "cloud · deleted" : "cloud") : "local"}
            </span>
            {!isCloud && (
              <span className="rounded-full bg-accent/12 px-1.5 text-2xs text-accent max-[900px]:hidden">
                try cloud
              </span>
            )}
          </button>
        )}
      >
        {(close) => (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">Workspace mode</span>
              <ModeToggle
                mode={sw.waiting ? "cloud" : cloud.mode}
                busy={sw.busy}
                onPick={(m) => void sw.to(m)}
              />
            </div>
            <Hint>
              {isCloud
                ? "Cloud: people sign in with their kraftwerk cloud account, cloud boards are shared, members join without a clone. Your files and agents stay on this machine."
                : "Local: just you, everything in files on this machine. Switch to cloud to work with others and reach this workspace from anywhere — your files and agents stay here."}
            </Hint>
            {sw.waiting && <Steps cloud={cloud} waiting />}
            <Problem cloud={cloud} error={sw.error} />
            <div className="flex flex-wrap items-center gap-2">
              <a
                className={buttonClass("secondary", "sm")}
                href={CLOUD_PAGE}
                onClick={close}
              >
                <Icon name="info" className="ms-sm" /> local or cloud?
              </a>
              {cloud.url && (
                <a
                  className={buttonClass("quiet", "sm")}
                  href={cloudLink ?? cloud.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="open_in_new" className="ms-sm" />{" "}
                  {cloudLink ? "open in the cloud" : "open kraftwerk cloud"}
                </a>
              )}
            </div>
          </div>
        )}
      </Popover>
      {cloudLink && (
        <a
          // cloud-link: the tests find it by this name.
          className="cloud-link grid size-7 flex-none place-items-center rounded-full text-accent no-underline transition-colors hover:bg-accent/12"
          href={cloudLink}
          target="_blank"
          rel="noreferrer"
          title="Open this workspace in kraftwerk cloud"
          aria-label="open this workspace in kraftwerk cloud"
        >
          <Icon name="open_in_new" className="ms-sm" />
        </a>
      )}
    </span>
  );
}

/** The settings page's panel: the switch, a line on each mode, the way to the full page. */
export function CloudModePanel() {
  const sw = useWorkspaceCloud();
  const { cloud } = sw;
  if (!cloud) return null;
  return (
    <Panel
      title="local or cloud"
      actions={
        <a className={buttonClass("secondary", "sm")} href={CLOUD_PAGE}>
          <Icon name="info" className="ms-sm" /> what's the difference?
        </a>
      }
    >
      <div className="flex flex-col gap-3 px-[18px] py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <ModeToggle
            mode={sw.waiting ? "cloud" : cloud.mode}
            busy={sw.busy}
            onPick={(m) => void sw.to(m)}
          />
          <span className="text-sm text-fg-2">
            {cloud.mode === "cloud" ? MODES.cloud.tagline : MODES.local.tagline}
          </span>
        </div>
        {sw.waiting && <Steps cloud={cloud} waiting />}
        {cloud.mode === "cloud" && !sw.waiting && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-2">
            <Icon name="cloud_sync" className="ms-sm" />
            The workspace's files: kraftwerk sync keeps them in step through kraftwerk cloud, for everyone on it — set up and set under <a href="#/settings">git sync</a>.
          </div>
        )}
        <Problem cloud={cloud} error={sw.error} />
      </div>
    </Panel>
  );
}

/** #/settings/cloud — the explanation, the switch, the steps, and this machine's record. */
export function CloudScreen() {
  const sw = useWorkspaceCloud();
  const { cloud } = sw;
  const mode = cloud?.mode;
  return (
    <Page>
      <PageHeader
        icon={mode === "cloud" ? "cloud" : "laptop_mac"}
        title="Local or cloud"
        sub="kraftwerk runs fully on your machine. Cloud mode adds people — and a way in from anywhere."
        actions={
          cloud && (
            <ModeToggle
              mode={sw.waiting ? "cloud" : cloud.mode}
              busy={sw.busy}
              onPick={(m) => void sw.to(m)}
            />
          )
        }
      />
      <ModeCompare mode={mode} />
      {cloud && (
        <Panel
          title={mode === "cloud" ? "cloud mode is on" : "switching to cloud"}
        >
          <div className="flex flex-col gap-3.5 px-[18px] py-4">
            {mode !== "cloud" && !sw.waiting && (
              <Hint>
                One click does it: kraftwerk connects this machine, registers
                the workspace and — the only step you do yourself — opens the
                cloud so you can sign in and claim the machine. Then this page
                asks you to sign in. Switching back to local is just as quick.
              </Hint>
            )}
            <Steps cloud={cloud} waiting={sw.waiting} />
            <Problem cloud={cloud} error={sw.error} />
            <div className="flex flex-wrap items-center gap-2">
              {mode !== "cloud" ? (
                <Button
                  variant="primary"
                  icon="cloud"
                  busy={sw.busy || sw.waiting}
                  onClick={() => void sw.to("cloud")}
                >
                  {sw.waiting ? (cloud.next === "connect" ? "connecting …" : "waiting for the claim …") : "switch to cloud"}
                </Button>
              ) : (
                <>
                  {cloud.workspaceUrl && (
                    <a
                      className={buttonClass("primary", "sm")}
                      href={cloud.workspaceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="open_in_new" className="ms-sm" /> open the
                      workspace in the cloud
                    </a>
                  )}
                  <a className={buttonClass("secondary", "sm")} href="#/boards">
                    <Icon name="view_kanban" className="ms-sm" /> create a cloud
                    board
                  </a>
                </>
              )}
            </div>
          </div>
        </Panel>
      )}
      <Faq />
      <CloudPanel />
    </Page>
  );
}

const QUESTIONS: [string, ReactNode][] = [
  [
    "What goes to the cloud?",
    <>
      In both modes your files, chats, knowledge, runs and agent sessions stay
      on this machine. Even in local mode, kraftwerk reports minimal usage info:
      the daemon registers the machine (its name, your handle, hostname,
      platform and kraftwerk version) and the workspaces it serves (their names
      and ids, no folder paths, no content). It is on by default;{" "}
      <code>cloud: {"{ enabled: false }"}</code> in a workspace's kraftwerk.yml
      leaves that workspace out, <code>kraftwerk cloud off</code> stops it for
      the whole machine. Once you claim the machine, the cloud also learns the
      folder paths and which routines ran. In cloud mode, cloud boards and their
      tasks live in the cloud.
    </>,
  ],
  [
    "Do my agents run in the cloud?",
    <>
      No. Agents always run here, on your own subscriptions and keys. In cloud
      mode they can pick up tasks from cloud boards, signed as themselves.
    </>,
  ],
  [
    "Can I go back to local?",
    <>
      Any time, with the same switch: nobody needs to sign in any more and cloud
      boards disappear from view — they stay in the cloud until you switch back.
      Local boards are untouched either way.
    </>,
  ],
  [
    "What about my teammates?",
    <>
      In cloud mode, <code>kraftwerk invite</code> (or the cloud's workspace
      page) gives them a link: they join as members and open the workspace from
      their browser — no clone, no install. Someone with a clone of the repo
      signs in with their own account on their own machine.
    </>,
  ],
  [
    "And in the terminal?",
    <>
      <code>kraftwerk cloud connect</code> does the same as the switch,{" "}
      <code>kraftwerk cloud disconnect</code> goes back;{" "}
      <code>kraftwerk boards create &lt;title&gt; --cloud</code> makes a cloud
      board.
    </>,
  ],
];

function Faq() {
  return (
    <Panel title="questions">
      <div className="flex flex-col divide-y divide-line">
        {QUESTIONS.map(([q, a]) => (
          <details key={q} className="group px-[18px] py-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
              <Icon
                name="chevron_right"
                className="ms-sm transition-transform group-open:rotate-90"
              />
              {q}
            </summary>
            <p className="m-0 mt-2 pl-6 text-sm text-fg-2">{a}</p>
          </details>
        ))}
      </div>
    </Panel>
  );
}
