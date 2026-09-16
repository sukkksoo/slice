import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Providers } from "./providers";
import "./globals.css";
import { SocialDock } from "@/components/Social";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-family",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Slice on Arc — Liquidity Infrastructure",
  description:
    "Stake liquidity in any token and earn a streamed share of swap fees in USDC. Route trading fees into automatic on-chain liquidity injections. Built on Uniswap v4, on Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8">{children}</main>
          <Footer />
          <SocialDock />
        </Providers>
      </body>
    </html>
  );
}
