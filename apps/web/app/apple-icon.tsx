import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
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
          borderRadius: 40,
        }}
      >
        <div
          style={{
            width: 126,
            height: 126,
            borderRadius: 63,
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              width: 98,
              height: 14,
              borderRadius: 7,
              background: "#d92d20",
              transform: "rotate(-28deg)",
              display: "flex",
              justifyContent: "space-around",
              overflow: "hidden",
            }}
          >
            <div style={{ width: 14, background: "#ffffff" }} />
            <div style={{ width: 14, background: "#ffffff" }} />
            <div style={{ width: 14, background: "#ffffff" }} />
          </div>
          <div
            style={{
              position: "absolute",
              width: 11,
              height: 74,
              borderRadius: 6,
              background: "#18324a",
              left: 23,
              top: 25,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 32,
              height: 32,
              borderRadius: 16,
              background: "#2b66b0",
              right: 17,
              bottom: 16,
              border: "5px solid #ffffff",
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
