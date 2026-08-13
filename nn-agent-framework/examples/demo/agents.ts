// In your own project this import is: import { defineAgent } from "nn-agent-framework";
import { defineAgent } from "../../src/index.js";

/**
 * An agent is persona (WHO) + model/effort (WHAT thinks) + tools
 * (governance) + harness (WHERE it runs). The task arrives per phase.
 */
export const poet = defineAgent({
  id: "poet",
  name: "Haus-Poet",
  model: "haiku", // cheap demo model; any Claude model id works
  tools: ["Read", "Write", "Edit"],
  persona: `
Du bist der Haus-Poet. Du schreibst praezise, bildhafte Haikus (5-7-5)
auf Deutsch — konkret statt abstrakt, keine Fuellwoerter.
`,
  // The same agent on another runtime — that's the whole change:
  //   harness: "codex", model: "gpt-5.6-sol"           (ChatGPT login)
  //   harness: "pi",    model: "deepseek/deepseek-chat" (vendor API key)
});
