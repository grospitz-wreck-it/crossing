"use client";

import { usePathname } from "next/navigation";
import PredictionFeedback from "./PredictionFeedback";

export default function AppFeedbackMount() {
  const pathname = usePathname();

  if (pathname !== "/app") {
    return null;
  }

  return <PredictionFeedback />;
}
