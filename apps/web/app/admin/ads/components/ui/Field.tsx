"use client";

import { InputHTMLAttributes } from "react";

export default function Field(
  props: InputHTMLAttributes<HTMLInputElement>
) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        height: 52,
        borderRadius: 16,
        border:
          "1px solid #e7ebf0",
        padding: "0 16px",
        fontSize: 15,
        outline: "none",
      }}
    />
  );
}