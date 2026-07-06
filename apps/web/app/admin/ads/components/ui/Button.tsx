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
        height: 52,
        padding: "0 22px",
        borderRadius: 16,
        fontWeight: 600,
        cursor: "pointer",

        border:
          variant === "secondary"
            ? "1px solid #e7ebf0"
            : "none",

        background:
          variant === "primary"
            ? "#4f637b"
            : "#fff",

        color:
          variant === "primary"
            ? "#fff"
            : "#334155",

        transition:
          ".2s",

        ...style,
      }}
    />
  );
}