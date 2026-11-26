import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./AppChrome.css";
import AppFeedbackMount from "./components/AppFeedbackMount";
import StatusDebugPanel from "./components/StatusDebugPanel";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.meineschranke.com"),
  title: "meine Schranke",
  description: "Schrankenstatus und nächste Zugbewegungen im Blick.",
  applicationName: "meine Schranke",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "meine Schranke",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#18324a",
};

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
