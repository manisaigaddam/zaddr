import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZADDR XO — No names. Just moves.",
  description: "A first-to-3 XO match played as zaddr faces, without profile names or addresses on the board.",
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
