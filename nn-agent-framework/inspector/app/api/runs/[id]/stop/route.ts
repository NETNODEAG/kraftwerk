import { NextResponse } from "next/server";
import { stopRun } from "@/lib/runner";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const stopped = stopRun(id);
  return stopped
    ? NextResponse.json({ stopped: true })
    : NextResponse.json(
        { error: "no running sandbox container for this run (local runs cannot be stopped here)" },
        { status: 404 }
      );
}
