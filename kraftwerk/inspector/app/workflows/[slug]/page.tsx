import { WorkflowView } from "./workflow-view";

export default async function WorkflowPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <WorkflowView slug={slug} />;
}
