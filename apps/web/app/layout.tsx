import type { ReactNode } from "react";
import "./globals.css";
import PredictionFeedback from "./components/PredictionFeedback";

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        {children}
        <PredictionFeedback />
      </body>
    </html>
  );
}
