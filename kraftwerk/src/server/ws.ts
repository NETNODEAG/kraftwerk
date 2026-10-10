import { createHash } from "node:crypto";
import type http from "node:http";
import type { Duplex } from "node:stream";

/**
 * A minimal WebSocket server side (RFC 6455), enough for the control
 * plane's socket: the handshake, text messages (fragmented or not), ping,
 * pong and close. No extensions, no binary messages — files stay on HTTP.
 * The server keeps no dependencies, and this is the whole of what it needs.
 */

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** One message (all its fragments) may not exceed this. */
const MAX_MESSAGE = 4_000_000;
const PING_MS = 25_000;
const CLOSE_GRACE_MS = 2_000;

export interface Socket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onMessage(fn: (text: string) => void): void;
  onClose(fn: () => void): void;
  readonly open: boolean;
}

/** Complete the upgrade, or answer 400 and return null when the request is not a WebSocket handshake. */
export function acceptWebSocket(req: http.IncomingMessage, socket: Duplex, head: Buffer): Socket | null {
  const key = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || typeof key !== "string" || req.headers["sec-websocket-version"] !== "13") {
    socket.end("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n");
    return null;
  }
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`);

  const messageFns: Array<(text: string) => void> = [];
  const closeFns: Array<() => void> = [];
  let open = true;
  let buf: Buffer = head.length ? Buffer.from(head) : Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let fragmentSize = 0;

  const frame = (opcode: number, payload: Buffer): Buffer => {
    const len = payload.length;
    const header = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10);
    if (len >= 126) {
      header[0] = 0x80 | opcode;
      if (len < 65_536) {
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
    }
    return Buffer.concat([header, payload]);
  };

  const finish = () => {
    if (!open) return;
    open = false;
    clearInterval(pinger);
    for (const fn of closeFns) fn();
  };
  const close = (code = 1000, reason = "") => {
    if (!open) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    socket.end(frame(0x8, payload));
    // The peer should close its side now; one that does not (or never saw the frame) must not keep the connection — or us — waiting.
    setTimeout(() => socket.destroy(), CLOSE_GRACE_MS).unref?.();
    finish();
  };

  const parse = () => {
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return close(1009, "message too large");
        len = Number(big);
        offset = 10;
      }
      // Clients must mask (RFC 6455 5.1); an unmasked frame is a protocol error.
      if (!masked) return close(1002, "unmasked frame");
      if (buf.length < offset + 4 + len) return;
      const mask = buf.subarray(offset, offset + 4);
      const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(offset + 4 + len);

      if (opcode === 0x8) return close();
      if (opcode === 0x9) {
        socket.write(frame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x2) return close(1003, "text only");
      if (opcode !== 0x1 && opcode !== 0x0) return close(1002, "unknown opcode");
      fragmentSize += payload.length;
      if (fragmentSize > MAX_MESSAGE) return close(1009, "message too large");
      fragments.push(payload);
      if (fin) {
        const text = Buffer.concat(fragments).toString("utf8");
        fragments = [];
        fragmentSize = 0;
        for (const fn of messageFns) fn(text);
      }
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    parse();
  });
  socket.on("close", finish);
  socket.on("error", finish);
  const pinger = setInterval(() => open && socket.write(frame(0x9, Buffer.alloc(0))), PING_MS);
  pinger.unref?.();
  if (buf.length) queueMicrotask(parse);

  return {
    get open() {
      return open;
    },
    send(text) {
      if (open) socket.write(frame(0x1, Buffer.from(text, "utf8")));
    },
    close,
    onMessage(fn) {
      messageFns.push(fn);
    },
    onClose(fn) {
      closeFns.push(fn);
    },
  };
}
