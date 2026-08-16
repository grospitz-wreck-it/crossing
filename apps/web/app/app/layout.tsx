import { redirect } from "next/navigation";
import { auth } from "../../auth";

import { CrossingsProvider } from "../context/CrossingsContext";
import Header from "../components/Header";

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
    <CrossingsProvider>
      <Header />
      {children}
    </CrossingsProvider>
  );
}