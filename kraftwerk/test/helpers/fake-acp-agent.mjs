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
      if (/ask a question/i.test(text)) {
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
