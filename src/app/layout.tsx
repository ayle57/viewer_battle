import type { ReactNode } from "react";
import { TRPCProvider } from "@/app/_trpc/Provider";
import "@/ui/tokens.css";

export const metadata = {
  title: "ViewerBattle",
  description: "Interactive 2v2 gameshow platform for livestreams.",
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
