// A scripted stand-in for an ACP adapter (KRAFTWERK_ACP_ADAPTER): no model,
// no tools, nothing runs. Each prompt asks the client for one permission
// ("Run npm install"), or with "ask a question" in the prompt one form
// question, then replies with what the human chose and ends the turn. Lets
// a test produce real waiting requests without spawning a coding agent.
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let n = 0;
new AgentSideConnection(
  (conn) => ({
    async initialize() {
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, authMethods: [] };
    },
    async newSession() {
      return { sessionId: `fake-${++n}` };
    },
    async authenticate() {
      return {};
    },
    async cancel() {},
    async prompt(params) {
      const text = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join(" ");
      let said;
      if (/(handed to you|created for you|moved to \S+ for you) by /.test(text)) {
        // A board woke this agent for a task (core/board-wake.ts): acknowledge, ask nothing.
        said = `on it: ${/Task (\S+) \(/.exec(text)?.[1] ?? "?"}`;
      } else if (/who am i/i.test(text)) {
        // The identity the process was handed (chat/backend.ts identityEnv) and whether a task block briefed it (core/boards.ts).
        said = `agent: ${process.env.KRAFTWERK_AGENT ?? ""}|${process.env.KRAFTWERK_ACTOR ?? ""}|${/## Your task: /.test(text) ? "task" : "no-task"}`;
      } else if (/where is temp/i.test(text)) {
        // What the process was handed for scratch, and whether the prompt briefed it (core/temp.ts).
        said = `temp: ${process.env.KRAFTWERK_TEMP ?? ""}|${process.env.TMPDIR ?? ""}|${/## Temporary files/.test(text) ? "briefed" : "unbriefed"}`;
      } else if (/ask a question/i.test(text)) {
        const r = await conn.createElicitation({
          sessionId: params.sessionId,
          mode: "form",
          message: "Which environment should I deploy to?",
          requestedSchema: { type: "object", properties: { env: { type: "string", title: "environment" } }, required: ["env"] },
        });
        said = `answer: ${JSON.stringify(r ?? null)}`;
      } else {
        const r = await conn.requestPermission({
          sessionId: params.sessionId,
          toolCall: { toolCallId: `t${Date.now()}`, title: "Run npm install", kind: "execute", status: "pending" },
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        });
        said = r.outcome.outcome === "selected" ? `you chose ${r.outcome.optionId}` : "cancelled";
      }
      await conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: said } } });
      return { stopReason: "end_turn" };
    },
  }),
  stream
);
