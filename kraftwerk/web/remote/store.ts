/**
 * What the remote page keeps on the phone (IndexedDB, shared by the page and
 * its service worker): the machines paired from here — each machine's key
 * and this device's token for it — and which one is open. Nothing of it
 * leaves the phone except the token, inside the encrypted channel.
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

const DB = "kraftwerk-remote";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("machines", { keyPath: "key" });
      req.result.createObjectStore("state");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: "machines" | "state", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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

export async function currentMachine(): Promise<Machine | undefined> {
  const [key, all] = await Promise.all([currentKey(), listMachines()]);
  return all.find((m) => m.key === key) ?? (all.length === 1 ? all[0] : undefined);
}

/** The short fingerprint `kraftwerk remote` shows for the same key, to compare by eye. */
export async function fingerprint(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  const hex = [...digest.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** The relay's client endpoint: the host that served this page relays too. */
export const relayUrl = (origin: string): string => `${origin.replace(/^http/, "ws")}/api/relay/client`;
