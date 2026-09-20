import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZADDR XO — No names. Just moves.",
  description: "Pick a public zaddr face, play X and O, and keep the owner unnamed.",
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
