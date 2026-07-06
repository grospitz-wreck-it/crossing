"use client";

import { ReactNode } from "react";

export default function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: 28,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: ".08em",
          textTransform:
            "uppercase",
          color: "#7a8796",
          marginBottom: 10,
        }}
      >
        {title}
      </div>

      {children}
    </div>
  );
}