"use client";

import { ReactNode } from "react";

export default function Chip({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "4px 8px",
        borderRadius: 6,
        background: "#1b2a3e",
        fontSize: 10,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
    </div>
  );
}