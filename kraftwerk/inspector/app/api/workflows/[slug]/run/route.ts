import { NextResponse } from "next/server";
import { getWorkflow } from "@/lib/workflows";
import { triggerRun, dockerStatus } from "@/lib/runner";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(dockerStatus());
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const wf = await getWorkflow(decodeURIComponent(slug));
  if (!wf || wf.error || !wf.name) {
    return NextResponse.json({ error: "workflow not found or broken" }, { status: 404 });
  }
  let body: { request?: string; sandbox?: boolean; ssh?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const request = (body.request ?? "").trim();
  if (!request) return NextResponse.json({ error: "request text is required" }, { status: 400 });

  try {
    const { runId } = triggerRun({
      workflowName: wf.name,
      request,
      sandbox: body.sandbox ?? true,
      ssh: !!body.ssh,
    });
    return NextResponse.json({ runId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }
}
