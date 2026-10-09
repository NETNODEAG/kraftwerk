/**
 * Chat building blocks: the thread view (event-log replay — text chunks
 * merge into agent messages, tool calls render as activity cards,
 * permission requests as decision cards with buttons), the new-chat pane,
 * and the composer. General chats live on the agent screen under the
 * "Ralv" entry; history comes from GET /api/chats/:id, live
 * events stream over SSE.
 */
export { ChatThread } from "./view";
export { NewChat, createChatAndOpen } from "./new-chat";
export { myName } from "./helpers";
