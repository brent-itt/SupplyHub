import type { Metadata } from "next";
import "./globals.css";
import "./system.css";

export const metadata: Metadata = {
  title: "SupplyHub",
  description:
    "Check university supply availability and manage inventory with SupplyHub at Panpacific University.",
  applicationName: "SupplyHub",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
