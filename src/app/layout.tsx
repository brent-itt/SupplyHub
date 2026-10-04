import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import "./system.css";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap", variable: "--font-poppins" });

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
    <html lang="en" className={poppins.variable} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
