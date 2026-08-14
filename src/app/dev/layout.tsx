import type { ReactNode } from "react";
import { DevNav } from "./_shared/DevNav";

export default function DevLayout({ children }: { children: ReactNode }) {
  return <DevNav>{children}</DevNav>;
}
