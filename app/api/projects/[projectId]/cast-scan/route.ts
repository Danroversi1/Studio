// Reads the script for characters it calls out who aren't in the cast yet. A route (not a
// server action) so the AI call never holds up page navigation.
import { NextResponse } from "next/server";
import { scanScriptCast } from "@/app/projects/[projectId]/actions";

export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return NextResponse.json(await scanScriptCast({ projectId }), { headers: { "Cache-Control": "no-store" } });
}
