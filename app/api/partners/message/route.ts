// One message to a creative partner. A route (not a server action) so she can keep moving
// around STUDIO while the partner thinks.
import { NextResponse } from "next/server";
import { sendPartnerMessage } from "@/app/projects/[projectId]/actions";

export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { projectId?: string; agent?: string; threadId?: string | null; content?: string } | null;
  if (!body?.projectId || !body.agent || typeof body.content !== "string") {
    return NextResponse.json({ error: "That message couldn't be sent.", unsent: true }, { status: 400 });
  }
  const res = await sendPartnerMessage({ projectId: body.projectId, agent: body.agent, threadId: body.threadId ?? null, content: body.content });
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
