import ForecastOverlay from "./ForecastOverlay";
import ApiBudgetPanel from "./ApiBudgetPanel";

export default function CrossingsAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ApiBudgetPanel />
      {children}
      <ForecastOverlay />
    </>
  );
}
