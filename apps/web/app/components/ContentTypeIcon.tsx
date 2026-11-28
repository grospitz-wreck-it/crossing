import AppIcon, { type AppIconName } from "./AppIcon";

const icons: Record<string, AppIconName> = {
  onboarding: "book-open",
  feature_tip: "lightbulb",
  local_news: "newspaper",
  event: "calendar",
  partner: "handshake",
};

type Props = {
  type?: string | null;
  size?: number;
  strokeWidth?: number;
};

export default function ContentTypeIcon({ type, size = 20, strokeWidth = 1.9 }: Props) {
  return <AppIcon name={icons[type || ""] || "info"} size={size} strokeWidth={strokeWidth} />;
}
