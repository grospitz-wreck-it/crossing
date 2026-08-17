import ForecastOverlay from "./ForecastOverlay";

export default function CrossingsAdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<ForecastOverlay /></>;
}
