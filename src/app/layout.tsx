import type { ReactNode } from "react";
import { TRPCProvider } from "@/app/_trpc/Provider";

export const metadata = {
  title: "ViewerBattle — Phase 0 spike",
  description: "Infrastructure validation spike, not the real app.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
