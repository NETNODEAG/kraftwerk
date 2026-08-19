import { RunsScreen } from "./run-detail";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunsScreen id={id} />;
}
