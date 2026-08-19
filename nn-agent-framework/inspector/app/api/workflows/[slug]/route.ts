import { NextResponse } from "next/server";
import { getWorkflow } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const wf = await getWorkflow(slug);
  if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(wf);
}
