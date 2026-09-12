import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-5 py-16 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        This link may have been removed.
      </p>
      <Link href="/" className="btn mt-4">
        Go to the start
      </Link>
    </main>
  );
}
