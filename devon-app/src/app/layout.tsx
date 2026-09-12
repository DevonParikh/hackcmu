import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tailor",
  description: "See where your week goes, then get one small assistant that gives some of it back.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
