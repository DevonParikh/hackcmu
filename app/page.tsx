import Start from "@/components/Start";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 pt-24 pb-24">
      <p className="text-muted">Tailor</p>
      <h1 className="display mt-3 text-[clamp(40px,7vw,64px)] font-semibold leading-[1.02]">
        Paste a website.<br />Find the chore.
      </h1>
      <p className="mt-6 mb-12 max-w-md text-muted">
        We read the site, find the repetitive thing that eats the most of the owner's week, show it in one chart,
        and build the one small AI tool that takes it over.
      </p>
      <Start />
    </main>
  );
}
