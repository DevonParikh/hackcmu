import { ToolView } from "@/components/ToolView";
import { tools } from "@/lib/db";
import { publicTool } from "@/lib/publicTool";

export const dynamic = "force-dynamic";

export default async function ToolPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { slug } = await params;
  const { embed } = await searchParams;
  const tool = await (await tools()).findOne({ _id: slug });
  if (!tool) {
    return (
      <main className="mx-auto max-w-xl px-5 py-16 text-center">
        <h1 className="text-2xl font-bold">Tool not found</h1>
        <p style={{ color: "var(--muted)" }}>This assistant may have been removed.</p>
      </main>
    );
  }
  return <ToolView tool={publicTool(tool)} embed={embed === "1"} />;
}
