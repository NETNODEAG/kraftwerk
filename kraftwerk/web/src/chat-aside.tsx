import { useEffect, useState, type ReactNode } from "react";
import { ChatThread } from "./chat";
import { OpenHere, chatIdOf } from "./chat-card";
import { Link, useHashPath } from "./shared";
import { IconButton } from "./ui";

/**
 * A page of the workspace (a skill, a workflow, a task, a knowledge bundle)
 * has no column for a conversation: a chat started on it opens in this
 * panel at the page's right edge, so the thing it was started from stays in
 * view. "open" takes the chat to its own route; leaving the page closes it.
 */
export function ChatAsideHost({ children }: { children: ReactNode }) {
  const [chat, setChat] = useState<{ id: string; href: string } | null>(null);
  const path = useHashPath().split("?")[0];
  useEffect(() => setChat(null), [path]);
  useEffect(() => {
    if (!chat) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !(e.target instanceof HTMLTextAreaElement && e.target.value)) setChat(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chat]);
  const take = (href: string) => {
    const id = chatIdOf(href);
    if (!id) return false;
    setChat({ id, href });
    return true;
  };
  return (
    <OpenHere.Provider value={take}>
      {children}
      {chat && (
        <aside
          className="chat-aside fixed top-[var(--topbar-h)] right-0 bottom-0 z-20 flex w-[min(560px,100vw)] animate-rise flex-col border-l border-line bg-bg shadow-[-8px_0_32px_rgb(0_0_0/0.08)]"
          aria-label="Chat started here"
          data-chat={chat.id}
        >
          <div className="flex flex-none items-center gap-2 border-b border-line px-3 py-2">
            <h2 className="m-0 min-w-0 flex-1 truncate text-base font-semibold text-fg">Chat</h2>
            <Link href={chat.href} className="text-sm text-fg-2 no-underline hover:text-fg" title="open the chat in its own place">
              open
            </Link>
            <IconButton icon="close" size="sm" label="close the chat panel" onClick={() => setChat(null)} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-3">
            <ChatThread key={chat.id} id={chat.id} />
          </div>
        </aside>
      )}
    </OpenHere.Provider>
  );
}
