"use client";

import { use } from "react";
import ConsolePage from "@/components/console-page";

type Props = { params: Promise<{ id: string }> };

export default function ConsoleRoutePage({ params }: Props) {
  const { id } = use(params);
  return <ConsolePage projectId={id} />;
}
