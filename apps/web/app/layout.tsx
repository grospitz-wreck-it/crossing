import type { ReactNode } from "react";
import "./globals.css";
import AppFeedbackMount from "./components/AppFeedbackMount";

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        {children}
        <AppFeedbackMount />
      </body>
    </html>
  );
}
