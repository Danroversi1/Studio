// Lays out scenes for new outline beats. A route (not a server action) so the long AI call
// never holds up page navigation.
import { NextResponse } from "next/server";
import { planScenesNow } from "@/app/projects/[projectId]/actions";

export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return NextResponse.json(await planScenesNow({ projectId }), { headers: { "Cache-Control": "no-store" } });
}
