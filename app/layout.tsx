import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live Rubric — 15 typed dimensions, scored as you type",
  description:
    "An editor that re-evaluates fifteen scored rubric dimensions on every typing pause, using TypeSafe's Jev. One request, all questions in parallel, fractions of a cent.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
