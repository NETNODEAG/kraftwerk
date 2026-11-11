import { parse } from "yaml";

/** Series colors, shared by the HTML chart and the PPTX one so both look alike: the template's accent, then fixed extras. */
export const chartPalette = (accent?: string): string[] => [accent ?? "#0284C7", "#F59E0B", "#10B981", "#8B5CF6", "#EF4444", "#64748B", "#EC4899"];

/**
 * Charts as SVG for the HTML slides: column, bar, line, area, pie and
 * doughnut from the same `chart` block the PowerPoint export turns into a
 * native chart. Pure — the web editor bundles it.
 */

export const CHART_KINDS = ["column", "bar", "line", "pie", "doughnut", "area"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartData {
  kind: ChartKind;
  title?: string;
  categories: string[];
  series: { name: string; values: number[] }[];
}

/** A chart block's YAML (fenced or bare) read and checked; throws with what is wrong. */
export function parseChart(source: string): ChartData {
  const body = source.replace(/^\s*```\s*chart\s*\n/, "").replace(/\n?```\s*$/, "");
  const data = parse(body) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") throw new Error("chart block must be a YAML mapping (kind, categories, series)");
  const kind = String(data.kind ?? "column");
  if (!CHART_KINDS.includes(kind as ChartKind)) throw new Error(`chart kind "${kind}" is not one of ${CHART_KINDS.join(", ")}`);
  const categories = Array.isArray(data.categories) ? data.categories.map(String) : [];
  if (!categories.length) throw new Error("chart needs categories: [a, b, …]");
  const seriesIn = Array.isArray(data.series) ? data.series : [];
  if (!seriesIn.length) throw new Error("chart needs series: [{name, values}]");
  const series = seriesIn.map((x, i) => {
    const row = (x ?? {}) as Record<string, unknown>;
    const values = Array.isArray(row.values) ? row.values.map(Number) : [];
    if (values.length !== categories.length || values.some((v) => Number.isNaN(v))) throw new Error(`series ${i + 1}: values must be ${categories.length} numbers`);
    return { name: String(row.name ?? `Series ${i + 1}`), values };
  });
  return { kind: kind as ChartKind, categories, series, ...(typeof data.title === "string" && data.title.trim() ? { title: data.title.trim() } : {}) };
}

/** Two decimals are plenty for a slide 1600 px wide. */
const tidy = (svg: string): string => svg.replace(/-?\d+\.\d{3,}/g, (n) => String(Math.round(Number(n) * 100) / 100));
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number): string => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US").replace(/,/g, "'") : String(Math.round(n * 100) / 100));

/** A "nice" axis: max and step for about five ticks. */
function niceAxis(max: number, min: number): { lo: number; hi: number; step: number } {
  const span = Math.max(max - Math.min(0, min), 1e-9);
  const raw = span / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  return { lo: Math.min(0, Math.floor(min / step) * step), hi: Math.ceil(max / step) * step || step, step };
}

/** The chart as an SVG string sized w × h (the slot's box in px), in the theme's palette and text colors. */
export function chartSvg(c: ChartData, w: number, h: number, look: { palette: string[]; text: string; muted: string; line: string; fontSize: number }): string {
  const fs = look.fontSize;
  const color = (i: number) => look.palette[i % look.palette.length];
  const parts: string[] = [];
  let top = 4;
  if (c.title) {
    parts.push(`<text x="${w / 2}" y="${fs * 1.1}" text-anchor="middle" font-weight="700" font-size="${fs * 1.1}" fill="${look.text}">${esc(c.title)}</text>`);
    top += fs * 1.7;
  }
  const legend = c.series.length > 1 || c.kind === "pie" || c.kind === "doughnut";
  const legendItems = c.kind === "pie" || c.kind === "doughnut" ? c.categories : c.series.map((s) => s.name);
  const bottomLegend = legend ? fs * 1.8 : 0;
  if (legend) {
    const itemW = legendItems.map((t) => t.length * fs * 0.55 + fs * 1.8);
    let x = (w - itemW.reduce((a, b) => a + b, 0)) / 2;
    const y = h - fs * 0.5;
    legendItems.forEach((t, i) => {
      parts.push(`<rect x="${x}" y="${y - fs * 0.75}" width="${fs * 0.8}" height="${fs * 0.8}" rx="${fs * 0.15}" fill="${color(i)}"/><text x="${x + fs * 1.1}" y="${y}" font-size="${fs * 0.9}" fill="${look.muted}">${esc(t)}</text>`);
      x += itemW[i];
    });
  }
  const plotH = h - top - bottomLegend;

  if (c.kind === "pie" || c.kind === "doughnut") {
    const vals = c.series[0].values.map((v) => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const r = Math.max(10, Math.min(w, plotH) / 2 - 4);
    const cx = w / 2;
    const cy = top + plotH / 2;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)} ${cy + rr * Math.sin(a)}`;
      if (v / total >= 0.9999) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color(i)}"/>`);
      else parts.push(`<path d="M ${cx} ${cy} L ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} Z" fill="${color(i)}" stroke="#fff" stroke-width="2"/>`);
      const mid = (a0 + a1) / 2;
      if (v / total > 0.06) parts.push(`<text x="${cx + r * (c.kind === "doughnut" ? 0.78 : 0.62) * Math.cos(mid)}" y="${cy + r * (c.kind === "doughnut" ? 0.78 : 0.62) * Math.sin(mid) + fs * 0.35}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#fff">${Math.round((v / total) * 100)}%</text>`);
      a0 = a1;
    });
    if (c.kind === "doughnut") parts.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="var(--c-background, #fff)"/>`);
    return tidy(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" font-family="inherit">${parts.join("")}</svg>`);
  }

  const all = c.series.flatMap((s) => s.values);
  const { lo, hi, step } = niceAxis(Math.max(...all, 0), Math.min(...all, 0));
  const horizontal = c.kind === "bar";
  const labelW = horizontal ? Math.min(w * 0.3, Math.max(...c.categories.map((t) => t.length)) * fs * 0.55 + fs) : Math.max(...[lo, hi].map((v) => fmt(v).length)) * fs * 0.6 + fs * 0.6;
  const left = labelW;
  const right = w - fs;
  const bottom = top + plotH - (horizontal ? fs * 1.6 : fs * 1.8);
  const plotTop = top + fs * 0.6;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  const n = c.categories.length;

  if (horizontal) {
    const scale = (v: number) => left + ((v - lo) / (hi - lo)) * (right - left);
    for (const t of ticks) parts.push(`<line x1="${scale(t)}" x2="${scale(t)}" y1="${plotTop}" y2="${bottom}" stroke="${look.line}"/><text x="${scale(t)}" y="${bottom + fs * 1.2}" text-anchor="middle" font-size="${fs * 0.85}" fill="${look.muted}">${fmt(t)}</text>`);
    const band = (bottom - plotTop) / n;
    const barH = (band * 0.7) / c.series.length;
    c.categories.forEach((cat, i) => {
      parts.push(`<text x="${left - fs * 0.5}" y="${plotTop + band * (i + 0.5) + fs * 0.35}" text-anchor="end" font-size="${fs * 0.9}" fill="${look.text}">${esc(cat)}</text>`);
      c.series.forEach((s, j) => {
        const y = plotTop + band * i + band * 0.15 + barH * j;
        const x0 = scale(Math.min(0, s.values[i]));
        parts.push(`<rect x="${x0}" y="${y}" width="${Math.abs(scale(s.values[i]) - scale(0))}" height="${barH * 0.92}" rx="2" fill="${color(j)}"/>`);
      });
    });
    return tidy(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" font-family="inherit">${parts.join("")}</svg>`);
  }

  const scale = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - plotTop);
  for (const t of ticks) parts.push(`<line x1="${left}" x2="${right}" y1="${scale(t)}" y2="${scale(t)}" stroke="${look.line}"/><text x="${left - fs * 0.4}" y="${scale(t) + fs * 0.32}" text-anchor="end" font-size="${fs * 0.85}" fill="${look.muted}">${fmt(t)}</text>`);
  const band = (right - left) / n;
  c.categories.forEach((cat, i) => parts.push(`<text x="${left + band * (i + 0.5)}" y="${bottom + fs * 1.3}" text-anchor="middle" font-size="${fs * 0.9}" fill="${look.text}">${esc(cat)}</text>`));
  if (c.kind === "column") {
    const barW = (band * 0.7) / c.series.length;
    c.series.forEach((s, j) =>
      s.values.forEach((v, i) => {
        const x = left + band * i + band * 0.15 + barW * j;
        const y = Math.min(scale(v), scale(0));
        parts.push(`<rect x="${x}" y="${y}" width="${barW * 0.92}" height="${Math.abs(scale(v) - scale(0))}" rx="2" fill="${color(j)}"/>`);
      }),
    );
  } else {
    c.series.forEach((s, j) => {
      const pts = s.values.map((v, i) => `${left + band * (i + 0.5)},${scale(v)}`);
      if (c.kind === "area") parts.push(`<polygon points="${left + band * 0.5},${scale(Math.max(lo, 0))} ${pts.join(" ")} ${left + band * (n - 0.5)},${scale(Math.max(lo, 0))}" fill="${color(j)}" fill-opacity="0.22"/>`);
      parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${color(j)}" stroke-width="${Math.max(2, fs * 0.18)}" stroke-linejoin="round" stroke-linecap="round"/>`);
      s.values.forEach((v, i) => parts.push(`<circle cx="${left + band * (i + 0.5)}" cy="${scale(v)}" r="${Math.max(3, fs * 0.22)}" fill="${color(j)}"/>`));
    });
  }
  parts.push(`<line x1="${left}" x2="${right}" y1="${scale(Math.max(lo, 0))}" y2="${scale(Math.max(lo, 0))}" stroke="${look.muted}"/>`);
  return tidy(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" font-family="inherit">${parts.join("")}</svg>`);
}

/** A YAML scalar: plain when it reads back the same, else quoted. */
const scalar = (s: string): string => (/^[\p{L}\p{N}][\p{L}\p{N} ._%'()/&+-]*$/u.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/^[\d.+-]+$/.test(s) ? s : JSON.stringify(s));

/**
 * A chart written back as its block: what the editor's data grid saves.
 * Compact and in the order people read it (kind, title, categories,
 * series); `fenced` keeps the ```chart fence the slot had.
 */
export function chartSource(c: ChartData, fenced: boolean): string {
  const lines = [`kind: ${c.kind}`, ...(c.title ? [`title: ${scalar(c.title)}`] : []), `categories: [${c.categories.map(scalar).join(", ")}]`, "series:"];
  for (const s of c.series) lines.push(`  - name: ${scalar(s.name)}`, `    values: [${s.values.map((v) => String(Math.round(v * 1e6) / 1e6)).join(", ")}]`);
  const body = lines.join("\n");
  return fenced ? `\`\`\`chart\n${body}\n\`\`\`` : body;
}
