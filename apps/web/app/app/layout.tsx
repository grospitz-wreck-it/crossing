import { redirect } from "next/navigation";
import { auth } from "../../auth";

import { CrossingsProvider } from "../context/CrossingsContext";
import Header from "../components/Header";
import CrossingSwipeNav from "../components/CrossingSwipeNav";
import styles from "./AppLayout.module.css";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <div className={styles.app}>
      <CrossingsProvider>
        <Header />
        <CrossingSwipeNav>
          {children}
        </CrossingSwipeNav>
      </CrossingsProvider>
    </div>
  );
}
