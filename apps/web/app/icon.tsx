import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#18324a",
          borderRadius: 112,
        }}
      >
        <div
          style={{
            width: 300,
            height: 300,
            borderRadius: 150,
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              width: 224,
              height: 32,
              borderRadius: 16,
              background: "#d92d20",
              transform: "rotate(-28deg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-evenly",
              overflow: "hidden",
            }}
          >
            <div style={{ width: 32, height: 32, background: "#ffffff" }} />
            <div style={{ width: 32, height: 32, background: "#ffffff" }} />
            <div style={{ width: 32, height: 32, background: "#ffffff" }} />
          </div>
          <div
            style={{
              position: "absolute",
              width: 24,
              height: 176,
              borderRadius: 12,
              background: "#18324a",
              left: 58,
              top: 62,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 72,
              height: 72,
              borderRadius: 36,
              background: "#2b66b0",
              right: 44,
              bottom: 42,
              border: "12px solid #ffffff",
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
