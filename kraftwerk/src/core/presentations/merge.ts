import type { SlideDef } from "./deck.js";

/**
 * Two editors on one deck (a person and an agent, two windows): the deck as
 * both last saw it (`base`), this side's version (`mine`) and the one that
 * reached the file first (`theirs`). Pure, so the web editor and the tests
 * share it.
 */
export interface DeckDraft {
  title: string;
  template: string;
  css: string;
  /** false: the deck shows no slide numbers. */
  numbers?: boolean;
  slides: SlideDef[];
}

type Draft = DeckDraft;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Someone else saved the deck while this editor had changes (an agent, the
 * CLI, another window): their version plus what was changed here, slide by
 * slide — a slide changed on both sides keeps theirs and is reported.
 */
export function mergeDrafts(base: Draft, mine: Draft, theirs: Draft): { draft: Draft; lost: number[] } {
  const pick = <T,>(b: T, m: T, t: T): T => (same(m, b) ? t : m);
  const head = { title: pick(base.title, mine.title, theirs.title), template: pick(base.template, mine.template, theirs.template), css: pick(base.css, mine.css, theirs.css), numbers: pick(base.numbers, mine.numbers, theirs.numbers) };
  if (same(base.slides, theirs.slides)) return { draft: { ...head, slides: mine.slides }, lost: [] };
  if (same(base.slides, mine.slides)) return { draft: { ...head, slides: theirs.slides }, lost: [] };
  const lost: number[] = [];
  if (mine.slides.length !== base.slides.length) return { draft: { ...head, slides: theirs.slides }, lost: mine.slides.map((_, i) => i + 1) };
  const slides = [...theirs.slides];
  mine.slides.forEach((m, i) => {
    if (same(m, base.slides[i])) return;
    const j = slides.findIndex((t) => same(t, base.slides[i]));
    if (j >= 0) slides[j] = m;
    else lost.push(i + 1);
  });
  return { draft: { ...head, slides }, lost };
}

