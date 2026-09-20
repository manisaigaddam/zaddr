import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZADDR — Nice to not meet you.",
  description: "Sit down as a public zaddr face. Play X and O. Owners stay shielded.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
