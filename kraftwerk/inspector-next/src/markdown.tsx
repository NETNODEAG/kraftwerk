import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

/** Markdown from an agent or a knowledge page, sanitized before it touches the DOM. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true })), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
