"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const db = /ECONNREFUSED|Server selection|Mongo/i.test(error.message);
  return (
    <main className="mx-auto max-w-xl px-5 py-16 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        {db ? "The database is not reachable right now. Check MONGODB_URI and try again in a moment." : "Please try again. If it keeps happening, the server logs have the details."}
      </p>
      <button className="btn mt-4" type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
