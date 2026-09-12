import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tailor",
  description: "Analyze a company, compare it to competitors, and build one small AI tool it can deploy today.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b" style={{ borderColor: "var(--rule)", background: "var(--panel)" }}>
          <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Tailor
            </Link>
            <nav className="flex gap-4 text-sm" style={{ color: "var(--muted)" }}>
              <Link href="/">Analyze</Link>
              <a href="https://github.com/DevonParikh/hackcmu" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
