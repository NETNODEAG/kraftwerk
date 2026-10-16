/**
 * The daemon's log line, one event per line in a fixed shape:
 *
 *   2026-10-15T14:26:47.662Z INFO  relay     connected to https://… as N8I…
 *   2026-10-15T14:26:47.901Z WARN  cloud     https://… unreachable — no answer (retrying)
 *   2026-10-15T12:25:33.105Z ERROR server    crashed: Error: listen EADDRINUSE …
 *
 * ISO-8601 UTC time, a padded level, a padded component, the message —
 * stable columns, grep-able, no glyphs, no color. The daemon's stdout IS
 * ~/.kraftwerk/logs/daemon.log (daemon-control appends the stream), so the
 * daemon and the long-running pieces it hosts (cloud client, relay,
 * scheduler) speak this and nothing else. Interactive commands keep their
 * human output; `kraftwerk daemon status` greps for "crashed:" and
 * "stopped unexpectedly", which stay literal in the message.
 */

export type LogLevel = "info" | "warn" | "error";

/** INFO to stdout, WARN and ERROR to stderr — the daemon writes both into one file. */
export function log(level: LogLevel, component: string, message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${component.padEnd(9)} ${message}`;
  if (level === "info") console.log(line);
  else console.error(line);
}
