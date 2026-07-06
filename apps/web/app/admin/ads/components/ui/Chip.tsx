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
        padding: "6px 10px",
        borderRadius: 999,
        background: "#f3f5f8",
        fontSize: 13,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
    </div>
  );
}