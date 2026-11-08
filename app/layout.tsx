import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

export const metadata = {
  title: "ratchet — it only clicks up",
  description: "A Solana memecoin launchpad with a floor that only ratchets up. Built on the higher.fun open-source template.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
        <Header />
        <main>{children}</main>
        <footer>
          ratchet · a launchpad built on the higher.fun open-source template, with a ratcheting floor added on top.
          Live on-chain (localnet), unaudited, not financial advice.
        </footer>
        </Providers>
      </body>
    </html>
  );
}
