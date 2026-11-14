import { redirect } from "next/navigation";
import { Empty } from "@/components/flash";
import { getProjectShell } from "@/lib/data";

export default async function ProjectHome({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const shell = await getProjectShell(projectId);
  const story = shell?.entities.find((e) => e.kind === "story");
  if (story) redirect(`/projects/${projectId}/items/${story.id}`);
  return <Empty title="Nothing approved yet">Approved story, characters and locations will appear here.</Empty>;
}
