// The deployed tool, as a customer sees it. Brand-tinted. Voice in and out. Refunds settle — or get refused — on chain.
import { db } from "@/lib/db";
import { safeAccent } from "@/lib/brand";
import Widget from "@/components/Widget";
import type { Tool } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = await (await db()).collection<Tool>("tools").findOne({ slug });
  if (!tool) return <main className="mx-auto max-w-xl px-6 py-24"><p>No such tool.</p></main>;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-6 pt-10 pb-8">
      <Widget slug={tool.slug} name={tool.name} company={tool.company} money={tool.money} accent={safeAccent(tool.brand.color)} demoWallet={tool.money ? "ravi" : ""} />
    </main>
  );
}
