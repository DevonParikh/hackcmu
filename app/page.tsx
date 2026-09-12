import Start from "@/components/Start";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-medium">Tailor</h1>
      <p className="mt-2 mb-10 max-w-md text-muted">
        Paste a company's website. We'll find the chore that eats the most of their week, show it in one chart,
        and build the one small AI tool that takes it over.
      </p>
      <Start />
    </main>
  );
}
