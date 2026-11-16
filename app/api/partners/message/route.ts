// One message to a creative partner. A route (not a server action) so she can keep moving
// around STUDIO while the partner thinks.
import { NextResponse } from "next/server";
import { sendPartnerMessage } from "@/app/projects/[projectId]/actions";

export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { projectId?: string; agent?: string; threadId?: string | null; content?: string; focus?: { storyboard_id?: string } | null } | null;
  if (!body?.projectId || !body.agent || typeof body.content !== "string") {
    return NextResponse.json({ error: "That message couldn't be sent.", unsent: true }, { status: 400 });
  }
  const res = await sendPartnerMessage({ projectId: body.projectId, agent: body.agent, threadId: body.threadId ?? null, content: body.content,
    focus: body.focus?.storyboard_id && /^[0-9a-f-]{36}$/i.test(body.focus.storyboard_id) ? { storyboard_id: body.focus.storyboard_id } : null });
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
