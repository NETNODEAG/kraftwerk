import { NextResponse } from "next/server";
import { listWorkflows } from "@/lib/workflows";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listWorkflows());
}
