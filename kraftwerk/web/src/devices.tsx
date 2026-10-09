import { useState, type ReactNode } from "react";
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

/** Settings → devices, on the machine kraftwerk runs on: who is paired, pair one more, unpair. */
export function DevicesPanel() {
  const self = useApi("devices.self", {}, { interval: 60_000 });
  const local = self?.trust === "local";
  const list = useApi("devices.list", local ? {} : null, { interval: 15_000 });
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; urls: string[] } | null>(null);
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
          {pairing.urls.length ? (
            <span className="text-sm text-fg-2">
              On the device, open {pairing.urls.map((u, i) => <span key={u}>{i > 0 && " or "}<code>{u}</code></span>)} and enter the code.
            </span>
          ) : (
            <span className="text-sm text-fg-2">
              This kraftwerk only listens on this machine. Restart it with <code>kraftwerk ui --lan</code> to reach it from your network (or use a tunnel), then enter
              the code on the device.
            </span>
          )}
        </FormStack>
      )}
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
