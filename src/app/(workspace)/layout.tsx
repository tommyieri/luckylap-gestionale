import type { ReactNode } from "react";
import { WorkspaceFrame } from "@/components/workspace-frame";

export const dynamic = "force-dynamic";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceFrame>{children}</WorkspaceFrame>;
}
