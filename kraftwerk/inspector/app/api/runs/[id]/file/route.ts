import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { readRunFile } from "@/lib/runs";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8",
};

/** Text preview payloads are capped; the tail matters most for logs. */
const MAX_TEXT = 400_000;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "";
  const raw = url.searchParams.get("raw") === "1";

  let file;
  try {
    file = await readRunFile(id, name);
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();

  if (raw) {
    const buf = await fs.readFile(file.absPath);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": TYPES[ext] ?? "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const buf = await fs.readFile(file.absPath);
  let text = buf.toString("utf8");
  let truncated = false;
  if (text.length > MAX_TEXT) {
    text = text.slice(-MAX_TEXT);
    truncated = true;
  }
  return NextResponse.json({ name, size: file.size, truncated, content: text });
}
