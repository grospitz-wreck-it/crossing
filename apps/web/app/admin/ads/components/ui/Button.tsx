"use client";

import { ButtonHTMLAttributes } from "react";

type Props =
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary";
  };

export default function Button({
  variant = "primary",
  style,
  ...props
}: Props) {
  return (
    <button
      {...props}
      style={{
        height: 36,
        padding: "0 13px",
        borderRadius: 8,
        fontWeight: 600,
        cursor: "pointer",

        border:
          variant === "secondary"
            ? "1px solid rgba(164,190,220,.18)"
            : "none",

        background:
          variant === "primary"
            ? "#e82f49"
            : "#17263a",

        color:
          variant === "primary"
            ? "#fff"
            : "#e5edf6",

        transition:
          ".2s",

        ...style,
      }}
    />
  );
}