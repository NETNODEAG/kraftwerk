import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "calculator", version: "2.0.0" });

server.tool(
  "add",
  "Add two numbers",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  })
);

server.tool(
  "subtract",
  "Subtract b from a",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a - b) }],
  })
);

server.tool(
  "multiply",
  "Multiply two numbers",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a * b) }],
  })
);

server.tool(
  "divide",
  "Divide a by b",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => {
    if (b === 0) {
      return {
        content: [{ type: "text", text: "Error: division by zero" }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: String(a / b) }] };
  }
);

server.tool(
  "power",
  "Raise a to the power of b",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a ** b) }],
  })
);

server.tool(
  "modulo",
  "Remainder of a divided by b",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => {
    if (b === 0) {
      return {
        content: [{ type: "text", text: "Error: modulo by zero" }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: String(a % b) }] };
  }
);

server.tool(
  "sqrt",
  "Square root of a",
  { a: z.number() },
  async ({ a }) => {
    if (a < 0) {
      return {
        content: [{ type: "text", text: "Error: square root of negative number" }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: String(Math.sqrt(a)) }] };
  }
);

await server.connect(new StdioServerTransport());
