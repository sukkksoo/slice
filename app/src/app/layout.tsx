import type { Metadata } from "next";

import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Delta on Arc — Liquidity Infrastructure",
  description:
    "Stake liquidity in any token and earn a streamed share of swap fees in USDC. Route trading fees into automatic on-chain liquidity injections. Built on Uniswap v4, on Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
