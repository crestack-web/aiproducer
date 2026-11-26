"use client";

import ProjectDetailPage from "./project-session-ui";
import { BoothOwnershipGate } from "./booth/booth-ownership-gate";

export default function ProjectSessionPage() {
  return (
    <BoothOwnershipGate>
      <ProjectDetailPage />
    </BoothOwnershipGate>
  );
}
