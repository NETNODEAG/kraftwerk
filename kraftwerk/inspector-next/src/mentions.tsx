import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

export interface Mentionable {
  /** What is written after the @: the server wakes an agent by `@<slug>`. */
  slug: string;
  name: string;
  emoji?: string;
}

/**
 * The "@…" being typed at the caret, if any. It follows the server's own rule
 * (channels.ts mentionTargets): an @ counts at the start or after anything
 * that is neither a word character nor another @, so "mail@max" is no mention.
 */
function tokenAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[^\w@])@([a-z0-9-]*)$/i.exec(before);
  return m ? { start: before.length - m[2].length - 1, query: m[2].toLowerCase() } : null;
}

/**
 * @-mention completion for a textarea. While an "@…" is being typed, a list of
 * the people that can be mentioned opens above the field: arrow keys move,
 * Enter or Tab picks, Escape closes it for that "@". The field keeps the
 * focus throughout; the list is announced through the combobox attributes.
 */
export function useMentions({ enabled, people, value, setValue, field }: {
  enabled: boolean;
  people: Mentionable[];
  value: string;
  setValue: (next: string) => void;
  field: RefObject<HTMLTextAreaElement | null>;
}): {
  /** The list to render next to the field (null while closed). */
  list: ReactNode;
  /** Call first in the field's onKeyDown; true = the key was for the list. */
  handleKey: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Spread on the textarea: caret tracking and the combobox semantics. */
  fieldProps: Record<string, unknown>;
} {
  const id = useId();
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  /** The "@" (by position) the user closed the list for with Escape. */
  const [dismissed, setDismissed] = useState<number | null>(null);

  const token = enabled ? tokenAt(value, caret) : null;
  const matches = useMemo(() => {
    if (!token) return [];
    const q = token.query;
    const starts = people.filter((p) => p.slug.startsWith(q) || p.name.toLowerCase().startsWith(q));
    const contains = people.filter((p) => !starts.includes(p) && (p.slug.includes(q) || p.name.toLowerCase().includes(q)));
    return [...starts, ...contains];
  }, [token?.query, token?.start, people]);
  const open = !!token && matches.length > 0 && dismissed !== token.start;

  useEffect(() => setIndex(0), [token?.query, token?.start]);
  useEffect(() => {
    if (!token) setDismissed(null);
  }, [token === null]);

  const pick = (person: Mentionable) => {
    if (!token) return;
    const inserted = `@${person.slug} `;
    // A space that already follows is not doubled.
    const rest = value.slice(caret).replace(/^ /, "");
    const next = value.slice(0, token.start) + inserted + rest;
    const at = token.start + inserted.length;
    setValue(next);
    setCaret(at);
    // After React wrote the value: the caret belongs behind the mention.
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(at, at);
    });
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || e.nativeEvent.isComposing) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(matches[Math.min(index, matches.length - 1)]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // not the dialog's, not the page's: only this list closes
      setDismissed(token!.start);
      return true;
    }
    return false;
  };

  const active = Math.min(index, matches.length - 1);
  const list = open ? (
    <ul className="mentions" id={id} role="listbox" aria-label="Mention an agent">
      {matches.map((p, i) => (
        <li
          key={p.slug}
          id={`${id}-${i}`}
          className="mention"
          role="option"
          aria-selected={i === active}
          // mousedown, and prevented: a click must not take the focus out of the field
          onMouseDown={(e) => {
            e.preventDefault();
            pick(p);
          }}
          onMouseEnter={() => setIndex(i)}
        >
          <span className="menu-emoji" aria-hidden>{p.emoji || "🤖"}</span>
          <span className="mention-name">{p.name}</span>
          <span className="mention-slug">@{p.slug}</span>
        </li>
      ))}
    </ul>
  ) : null;

  const track = () => setCaret(field.current?.selectionStart ?? 0);
  return {
    list,
    handleKey,
    fieldProps: enabled
      ? {
          // Wherever the caret goes: onSelect covers arrow keys and clicks, onInput
          // makes sure a typed "@" is seen in the same render as the new text.
          onSelect: track,
          onInput: track,
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": open,
          "aria-controls": open ? id : undefined,
          "aria-activedescendant": open ? `${id}-${active}` : undefined,
        }
      : {},
  };
}
