import { NextResponse } from "next/server";
import { getRun } from "@/lib/runs";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const run = await getRun(id);
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch {
    return NextResponse.json({ error: "invalid run id" }, { status: 400 });
  }
}
