import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolView } from "@/components/ToolView";
import { tools } from "@/lib/db";
import { publicTool } from "@/lib/publicTool";
import type { ToolDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadTool(slug: string): Promise<{ tool: ToolDoc | null; error: string | null }> {
  try {
    return { tool: await (await tools()).findOne({ _id: slug }), error: null };
  } catch (e) {
    return { tool: null, error: (e as Error).message };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { tool } = await loadTool(slug);
  return { title: tool ? tool.config.name : "Assistant" };
}

export default async function ToolPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { slug } = await params;
  const { embed } = await searchParams;
  const { tool, error } = await loadTool(slug);
  if (error) {
    return (
      <main className="mx-auto max-w-md px-5 py-12 text-center text-sm">
        <p className="font-semibold">The assistant is temporarily unavailable.</p>
        <p className="mt-1" style={{ color: "var(--muted)" }}>
          Please try again in a few minutes, or use the contact details on the website.
        </p>
      </main>
    );
  }
  if (!tool) notFound();
  return <ToolView tool={publicTool(tool)} embed={embed === "1"} />;
}
