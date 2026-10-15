/**
 * What the remote page keeps on the phone (IndexedDB, shared by the page and
 * its service worker): the machines paired from here — each machine's key
 * and this device's token for it —, the workspaces joined as a remote
 * member — the workspace, its hosts and this account's member token for it —
 * and which one is open. Nothing of it leaves the phone except the tokens,
 * inside the encrypted channel (and to the cloud that issued them).
 */

export interface Machine {
  /** The machine's public key (base64url) — its identity. */
  key: string;
  /** This device's token on that machine (kwd_…). */
  token: string;
  /** What the pairing link called the machine (its host name). */
  label: string;
  pairedAt: string;
}

/** A machine that hosts a joined workspace, as the cloud lists it. */
export interface Host {
  machineId: string;
  machineName: string;
  handle?: string | null;
  /** The machine's public key (base64url): the end of the tunnel. */
  publicKey: string;
  online: boolean;
  lastSeen?: number;
}

/** A workspace this phone's account joined as a remote member (no clone; through a host's relay). */
export interface Joined {
  /** The cloud's workspace id (ws_…). */
  workspaceId: string;
  name: string;
  role: string;
  /** The member token for this workspace (kwm_…), from the invite or minted with the session. */
  token?: string;
  hosts: Host[];
  /** The host last opened through, when the workspace has several. */
  hostKey?: string;
  /** Its address on the host, from the last answer to the member's hello: /w/<slug>/. */
  slug?: string;
  /** The host's last refusal, shown on the list until the next try. */
  error?: string;
  joinedAt: string;
}

const DB = "kraftwerk-remote";

/** Version 2 added `joined`; the stores of version 1 are kept as they were. */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      if (!names.contains("machines")) req.result.createObjectStore("machines", { keyPath: "key" });
      if (!names.contains("state")) req.result.createObjectStore("state");
      if (!names.contains("joined")) req.result.createObjectStore("joined", { keyPath: "workspaceId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: "machines" | "state" | "joined", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const listMachines = (): Promise<Machine[]> => tx("machines", "readonly", (s) => s.getAll() as IDBRequest<Machine[]>);
export const saveMachine = (m: Machine): Promise<unknown> => tx("machines", "readwrite", (s) => s.put(m));
export const forgetMachine = (key: string): Promise<unknown> => tx("machines", "readwrite", (s) => s.delete(key));
export const currentKey = (): Promise<string | undefined> => tx("state", "readonly", (s) => s.get("current") as IDBRequest<string | undefined>);
export const setCurrent = (key: string): Promise<unknown> => tx("state", "readwrite", (s) => s.put(key, "current"));

export const listJoined = (): Promise<Joined[]> => tx("joined", "readonly", (s) => s.getAll() as IDBRequest<Joined[]>);
export const getJoined = (id: string): Promise<Joined | undefined> => tx("joined", "readonly", (s) => s.get(id) as IDBRequest<Joined | undefined>);
export const saveJoined = (j: Joined): Promise<unknown> => tx("joined", "readwrite", (s) => s.put(j));
export const forgetJoined = (id: string): Promise<unknown> => tx("joined", "readwrite", (s) => s.delete(id));

/** `current` holds a machine's key (as it always did) or, for a joined workspace, this prefix and its id. */
const JOINED = "joined:";
export const setCurrentJoined = (id: string): Promise<unknown> => setCurrent(JOINED + id);

export async function currentMachine(): Promise<Machine | undefined> {
  const [key, all] = await Promise.all([currentKey(), listMachines()]);
  if (key?.startsWith(JOINED)) return undefined;
  return all.find((m) => m.key === key) ?? (all.length === 1 ? all[0] : undefined);
}

/** What is open: a joined workspace when one was picked last, else the paired machine as before. */
export async function currentTarget(): Promise<{ machine: Machine } | { joined: Joined } | undefined> {
  const key = await currentKey();
  if (key?.startsWith(JOINED)) {
    const j = await getJoined(key.slice(JOINED.length));
    if (j) return { joined: j };
    // That workspace was forgotten: a phone with one paired machine opens it, as it always did.
    const all = await listMachines();
    return all.length === 1 ? { machine: all[0] } : undefined;
  }
  const machine = await currentMachine();
  return machine ? { machine } : undefined;
}

/** The host to open a joined workspace through: the one picked, if it is still a host, else the first online one, else the first. */
export const pickHost = (j: Joined): Host | undefined =>
  j.hosts.find((h) => h.publicKey === j.hostKey) ?? j.hosts.find((h) => h.online) ?? j.hosts[0];

/** The short fingerprint `kraftwerk remote` shows for the same key, to compare by eye. */
export async function fingerprint(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  const hex = [...digest.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** The relay's client endpoint: the host that served this page relays too — for paired machines and members' hosts alike. */
export const relayUrl = (origin: string): string => `${origin.replace(/^http/, "ws")}/api/relay/client`;
