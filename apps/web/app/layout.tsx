import type { ReactNode } from "react";
import "./globals.css";
import "./AppChrome.css";
import AppFeedbackMount from "./components/AppFeedbackMount";
import StatusDebugPanel from "./components/StatusDebugPanel";

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
        <StatusDebugPanel />
      </body>
    </html>
  );
}
