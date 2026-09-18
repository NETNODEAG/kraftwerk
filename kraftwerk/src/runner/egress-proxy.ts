import http from "node:http";
import net from "node:net";

/**
 * Egress proxy for sandboxed agents: an HTTP proxy that only forwards to
 * hosts on an allowlist.
 *
 * A sandbox with `network: allowlist` joins a Docker network with no route
 * out; the only thing it can reach is this proxy, which sits on that network
 * and on an ordinary one. So the allowlist is not advice the agent could
 * ignore — there is no other way to the internet, and a denied host fails
 * because the packets have nowhere to go.
 *
 * HTTPS goes through CONNECT, where the proxy sees the host and the port and
 * nothing else. That is exactly enough to allow a domain and refuse the rest,
 * and it means no certificate is forged and no traffic is read: the tunnel is
 * opaque once it is open. Plain HTTP is forwarded the ordinary way.
 *
 * Denials are logged to stdout, because the failure an agent reports ("could
 * not connect") says nothing about which host was refused — `docker logs` on
 * the proxy is where that question is answered.
 */

export interface ProxyOptions {
  /** Hostnames, or `*.example.com` for a domain and its subdomains. */
  allow: string[];
  port: number;
  /** Where denials and starts are written. */
  log?: (line: string) => void;
}

/** A host is allowed by an exact match, or by a `*.suffix` rule covering it. */
export function hostAllowed(host: string, allow: string[]): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return allow.some((raw) => {
    const rule = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!rule) return false;
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1); // ".example.com"
      // The wildcard covers the subdomains and the domain itself: an
      // allowlist naming *.example.com that refused example.com would be
      // surprising in exactly the way a security control must not be.
      return name.endsWith(suffix) || name === rule.slice(2);
    }
    return name === rule;
  });
}

/** Split "host:port" (or a bare host) into its parts; IPv6 literals included. */
function splitHostPort(value: string, fallbackPort: number): { host: string; port: number } {
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    const host = value.slice(1, close);
    const rest = value.slice(close + 1);
    return { host, port: rest.startsWith(":") ? Number(rest.slice(1)) || fallbackPort : fallbackPort };
  }
  const colon = value.lastIndexOf(":");
  if (colon < 0) return { host: value, port: fallbackPort };
  const port = Number(value.slice(colon + 1));
  return Number.isFinite(port) && port > 0
    ? { host: value.slice(0, colon), port }
    : { host: value, port: fallbackPort };
}

export function startEgressProxy(opts: ProxyOptions): http.Server {
  const log = opts.log ?? ((line: string) => console.log(line));
  const deny = (host: string, how: string): void =>
    log(`DENY ${how} ${host} — not in the allowlist (${opts.allow.join(", ") || "empty"})`);

  const server = http.createServer((req, res) => {
    // Same reasoning as the CONNECT handler: a client that disappears must
    // not be able to end the proxy.
    req.on("error", () => res.destroy());
    res.on("error", () => res.destroy());
    // Plain HTTP: a proxy request carries the absolute URL.
    let target: URL;
    try {
      target = new URL(req.url ?? "", "http://invalid.invalid");
    } catch {
      res.writeHead(400).end("bad request URI\n");
      return;
    }
    if (target.hostname === "invalid.invalid") {
      res.writeHead(400).end("this is a proxy: send an absolute URI\n");
      return;
    }
    if (!hostAllowed(target.hostname, opts.allow)) {
      deny(target.hostname, "HTTP");
      res.writeHead(403, { "content-type": "text/plain" }).end(
        `egress to ${target.hostname} is not allowed by this sandbox\n`
      );
      return;
    }
    const upstream = http.request(
      {
        host: target.hostname,
        port: Number(target.port) || 80,
        method: req.method,
        path: target.pathname + target.search,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      }
    );
    upstream.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`upstream error: ${err.message}\n`);
    });
    req.pipe(upstream);
  });

  // HTTPS: CONNECT host:443, then an opaque tunnel. The host name is all the
  // proxy learns, and all it needs.
  server.on("connect", (req, socket: net.Socket, head: Buffer) => {
    // Before anything else: a client that is refused usually hangs up at
    // once, and an unhandled 'error' on this socket takes the whole process
    // down — one denied request would cost the agent its egress entirely.
    socket.on("error", () => socket.destroy());
    const { host, port } = splitHostPort(req.url ?? "", 443);
    if (!hostAllowed(host, opts.allow)) {
      deny(host, "CONNECT");
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n" +
          `egress to ${host} is not allowed by this sandbox\n`
      );
      return;
    }
    const upstream = net.connect(port, host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const fail = (): void => {
      // Either half dying takes the pair down; a half-open tunnel would
      // leave the agent waiting on a socket that will never answer.
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", (err) => {
      if (!socket.destroyed && !socket.writableEnded) {
        socket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n${(err as Error).message}\n`);
      }
      fail();
    });
    socket.on("error", fail);
    socket.on("close", () => upstream.destroy());
  });

  // The proxy is the sandbox's only route out: if it exits, the agent is
  // offline until someone notices. Log and keep serving.
  process.on("uncaughtException", (err) => log(`uncaught: ${(err as Error).message}`));
  server.on("clientError", (_err, socket) => socket.destroy());

  server.listen(opts.port, "0.0.0.0", () => {
    log(`egress proxy on :${opts.port} — allowed: ${opts.allow.join(", ") || "(nothing)"}`);
  });
  return server;
}
