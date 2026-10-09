import { useMemo, useState, type ReactNode } from "react";
import qrcode from "qrcode-generator";
import { api, failure, useApi, usePairingNeeded } from "./api";
import { fmtAgo, Icon } from "./shared";
import { Button, EmptyState, Field, FormStack, Notice, Panel, PanelRow, PanelRows, TextField, Title } from "./ui";

/**
 * Paired devices in the web UI: the pairing screen a browser on the network
 * gets until it is paired (PairingGate), and the settings panel where this
 * machine lists, pairs and unpairs devices (DevicesPanel). Pairing sets an
 * HttpOnly cookie, so after a reload the browser is a device like any other.
 */

/** A guess at the device's name for the list: "iPhone · Safari". Editable before pairing. */
function deviceGuess(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${os} · ${browser}` : os;
}

function PairScreen() {
  const [code, setCode] = useState("");
  const [name, setName] = useState(deviceGuess);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pair = async () => {
    setBusy(true);
    setError("");
    const r = await api.request("devices.pair", { body: { code, name } }).catch(() => null);
    if (r?.ok) return location.reload();
    setBusy(false);
    setError(r ? failure(r) : "could not reach kraftwerk");
  };
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center gap-5 px-4">
      <div className="flex flex-col gap-2">
        <Icon name="phonelink_lock" className="text-[32px] text-fg-2" />
        <Title size="lg">Pair this device</Title>
        <p className="m-0 text-sm leading-relaxed text-fg-2">
          This kraftwerk runs on another machine. On that machine, run <code>kraftwerk devices pair</code> or open settings → devices, and enter the code
          here. You pair once; it stays paired until it is removed there.
        </p>
      </div>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void pair();
        }}
      >
        <Field label="pairing code">
          <TextField
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-EF23"
            autoFocus
            autoComplete="one-time-code"
            autoCapitalize="characters"
            aria-label="pairing code"
            className="font-mono tracking-widest"
          />
        </Field>
        <Field label="name of this device" hint="how it shows in the list of paired devices">
          <TextField value={name} onChange={(e) => setName(e.target.value)} aria-label="device name" />
        </Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button variant="primary" type="submit" busy={busy} disabled={!code.trim()}>
          pair
        </Button>
      </form>
    </main>
  );
}

/** The app, or the pairing screen once the server said this browser is not paired. */
export function PairingGate({ children }: { children: ReactNode }) {
  return usePairingNeeded() ? <PairScreen /> : <>{children}</>;
}

/** A QR code for `text`, drawn in the text colour so it reads in light and dark. */
function QrCode({ text, size = 176 }: { text: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { d, n: n + 8 };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${path.n} ${path.n}`} width={size} height={size} role="img" aria-label="pairing QR code" className="rounded-lg bg-white text-black" shapeRendering="crispEdges">
      <path d={path.d} fill="currentColor" />
    </svg>
  );
}

/**
 * Remote access: the daemon holds a socket to the relay, and paired devices
 * reach this machine from anywhere through it, end to end encrypted.
 */
function RemoteAccess({ onError }: { onError: (e: string) => void }) {
  const relay = useApi("devices.relay", {}, { interval: 10_000 });
  const [busy, setBusy] = useState(false);
  if (!relay) return null;
  const toggle = async () => {
    setBusy(true);
    const r = await api.request("devices.setRelay", { body: { enabled: !relay.enabled } }).catch(() => null);
    setBusy(false);
    if (r && !r.ok) onError(failure(r));
  };
  const state = !relay.enabled
    ? "off — devices reach this machine on your network only"
    : !relay.daemon
      ? "on — the daemon connects it (this kraftwerk is not the daemon: `kraftwerk daemon`)"
      : relay.state === "connected"
        ? `connected${relay.clients ? ` · ${relay.clients} device${relay.clients === 1 ? "" : "s"} now` : ""}`
        : relay.state === "error"
          ? `not connected: ${relay.error ?? "unknown error"}`
          : "connecting…";
  return (
    <PanelRows>
      <PanelRow
        icon={relay.enabled ? "public" : "public_off"}
        title="reach this machine from anywhere"
        data-relay={relay.enabled ? relay.state : "off"}
        action={
          <Button size="sm" busy={busy} variant={relay.enabled ? undefined : "primary"} onClick={() => void toggle()}>
            {relay.enabled ? "turn off" : "turn on"}
          </Button>
        }
      >
        <span className="text-xs text-fg-2">
          {state}
          {relay.enabled && relay.fingerprint && <> · machine key <code>{relay.fingerprint}</code></>} — through the kraftwerk relay, end to end encrypted: it cannot read along
        </span>
      </PanelRow>
    </PanelRows>
  );
}

/** Settings → devices, on the machine kraftwerk runs on: who is paired, pair one more, unpair. */
export function DevicesPanel() {
  const self = useApi("devices.self", {}, { interval: 60_000 });
  const local = self?.trust === "local";
  const list = useApi("devices.list", local ? {} : null, { interval: 15_000 });
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; urls: string[]; remote?: string } | null>(null);
  const [error, setError] = useState("");

  if (!self) return null;
  // On a paired device the panel says what this browser is, nothing more.
  if (!local) {
    return (
      <Panel title="devices">
        <PanelRows>
          <PanelRow icon="phonelink_lock" title={`this browser is paired as “${self.device?.name}”`}>
            <span className="text-xs text-fg-2">devices are managed on the machine kraftwerk runs on</span>
          </PanelRow>
        </PanelRows>
      </Panel>
    );
  }

  const newCode = async () => {
    setError("");
    const r = await api.request("devices.code").catch(() => null);
    if (r?.ok) setPairing(r.data);
    else setError(r ? failure(r) : "could not make a code");
  };
  const revoke = async (id: string, name: string) => {
    if (!window.confirm(`Unpair “${name}”? It loses access at once.`)) return;
    const r = await api.request("devices.revoke", { id }).catch(() => null);
    if (r && !r.ok) setError(failure(r));
  };

  return (
    <Panel title="devices" actions={<Button size="sm" icon="add_link" onClick={() => void newCode()}>pair a device</Button>}>
      {pairing && (
        <FormStack className="border-b border-line">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-[22px] font-semibold tracking-widest text-fg" aria-label="pairing code">{pairing.code}</span>
            <span className="text-xs text-fg-2">once, until {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          {pairing.remote && (
            <div className="flex flex-wrap items-center gap-4">
              <QrCode text={pairing.remote} />
              <span className="max-w-[28ch] text-sm text-fg-2">
                From anywhere: scan this with the phone's camera, or open <a href={pairing.remote} target="_blank" rel="noreferrer">the pairing link</a> on it. It
                carries the code — treat it like a password.
              </span>
            </div>
          )}
          {pairing.urls.length ? (
            <span className="text-sm text-fg-2">
              On the device, open {pairing.urls.map((u, i) => <span key={u}>{i > 0 && " or "}<code>{u}</code></span>)} and enter the code.
            </span>
          ) : pairing.remote ? null : (
            <span className="text-sm text-fg-2">
              This kraftwerk only listens on this machine. Restart it with <code>kraftwerk ui --lan</code> to reach it from your network (or use a tunnel), then enter
              the code on the device — or turn on “reach this machine from anywhere”.
            </span>
          )}
        </FormStack>
      )}
      <RemoteAccess onError={setError} />
      {error && <div className="px-[18px] pt-3"><Notice tone="bad">{error}</Notice></div>}
      {list && list.devices.length === 0 && !pairing && <EmptyState icon="devices">no paired devices — a phone or another computer can use this kraftwerk once paired</EmptyState>}
      {list && list.devices.length > 0 && (
        <PanelRows>
          {list.devices.map((d) => (
            <PanelRow
              key={d.id}
              icon="devices"
              title={d.name}
              data-device={d.id}
              action={<Button size="sm" variant="danger" icon="link_off" onClick={() => void revoke(d.id, d.name)} aria-label={`unpair ${d.name}`}>unpair</Button>}
            >
              <span className="text-xs text-fg-2">
                paired {fmtAgo(d.createdAt)} · {d.lastSeenAt ? `last seen ${fmtAgo(d.lastSeenAt)}` : "not used yet"}
              </span>
            </PanelRow>
          ))}
        </PanelRows>
      )}
    </Panel>
  );
}
