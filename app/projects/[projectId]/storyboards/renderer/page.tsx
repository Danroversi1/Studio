import Link from "next/link";
import { redirect } from "next/navigation";
import { myDevices } from "@/app/projects/[projectId]/local-actions";
import { RendererSetup } from "@/components/storyboard/renderer-setup";
import { getProjectShell } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RendererPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const shell = await getProjectShell(projectId);
  if (!shell?.project || !shell.caps.member) redirect("/projects");
  const devices = await myDevices();
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/projects/${projectId}/storyboards`} className="eyebrow">← Storyboards</Link>
      <h1 className="display text-3xl">Connect Local Renderer</h1>
      <p className="help max-w-2xl">Generate storyboard frames on your own computer, guided by your cast, locations, Look &amp; Feel and your composition. Optional: drawing and arranging frames by hand works without it.</p>
      <RendererSetup initial={devices} />
    </div>
  );
}
