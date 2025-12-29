import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Candle Keep",
  description: "Candle Keep — a calm place to keep your notes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
