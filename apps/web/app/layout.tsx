import "./globals.css";
import { CrossingsProvider } from "./context/CrossingsContext";
import Header from "./components/Header";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        <CrossingsProvider>
          <Header />
          {children}
        </CrossingsProvider>
      </body>
    </html>
  );
}