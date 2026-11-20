// The World simulation now lives on World & Time (one place for the world, its time and how
// it moves day by day). Old links land there.
import { redirect } from "next/navigation";

export default async function SimulationPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/world#simulation`);
}
