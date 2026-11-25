"use client";

import { ReactNode } from "react";

export default function Card({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: "#111d2d",
        borderRadius: 12,
        boxShadow:
          "0 8px 24px rgba(0,0,0,.16)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}