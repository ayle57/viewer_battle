import type { ReactNode } from "react";
import { TRPCProvider } from "@/app/_trpc/Provider";
import { PageTransition } from "@/app/_shared/PageTransition";
import { PageChangeCurtain } from "@/app/_shared/PageChangeCurtain";
import { ReturnToGameCorner } from "@/app/_shared/ReturnToGameCorner";
import "@/ui/tokens.css";

export const metadata = {
  title: "ViewerBattle",
  description: "Interactive 2v2 gameshow platform for livestreams.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Covers the rare genuine cross-document navigation (typing a
          URL, a hard refresh, a link opened with "open in new tab" then
          navigated) with the browser's native View Transitions API
          (Chrome/Edge; a no-op elsewhere). Every `next/link` click
          — the overwhelming majority of navigation in this app — never
          triggers this (client-side routing has no document unload to
          transition), which is exactly what PageTransition.tsx exists
          to actually handle; the two are complementary, not redundant.
        */}
        <meta name="view-transition" content="same-origin" />
      </head>
      <body>
        <TRPCProvider>
          <PageTransition>{children}</PageTransition>
          <PageChangeCurtain />
          <ReturnToGameCorner />
        </TRPCProvider>
      </body>
    </html>
  );
}
