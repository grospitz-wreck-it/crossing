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
        background: "#fff",
        borderRadius: 28,
        boxShadow:
          "0 8px 32px rgba(0,0,0,.06)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}