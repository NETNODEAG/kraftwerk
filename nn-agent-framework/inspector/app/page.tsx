import { redirect } from "next/navigation";
import { listRuns, OUTPUT_DIR } from "@/lib/runs";

export const dynamic = "force-dynamic";

/** The runs screen lives at /runs/<id>; land on the latest run. */
export default async function Home() {
  const runs = await listRuns();
  if (runs.length > 0) redirect(`/runs/${runs[0].id}`);
  return (
    <div className="empty">
      No runs found in <code>{OUTPUT_DIR}</code>. Start one with{" "}
      <code>kraftwerk run &lt;workflow&gt; &lt;request&gt;</code> or from a workflow page.
    </div>
  );
}
