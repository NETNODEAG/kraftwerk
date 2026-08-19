import { NextResponse } from "next/server";
import { listRuns, OUTPUT_DIR } from "@/lib/runs";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await listRuns();
  return NextResponse.json({ outputDir: OUTPUT_DIR, runs });
}
