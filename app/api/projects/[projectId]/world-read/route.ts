// Reads her story for a setting she already wrote. A route so it never blocks navigation.
import { NextResponse } from "next/server";
import { readStoryForWorld } from "@/app/projects/[projectId]/world-actions";

export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return NextResponse.json(await readStoryForWorld({ projectId }), { headers: { "Cache-Control": "no-store" } });
}
