import type { SVGProps } from "react";
import AppIcon, { type AppIconName } from "../../components/AppIcon";

export type AdminIconName = Extract<AppIconName,
  | "home" | "railway" | "clock" | "megaphone" | "users"
  | "activity" | "chart" | "trash" | "pencil" | "pause"
  | "play" | "plus" | "x" | "arrow-up-right" | "arrow-right"
  | "arrow-up-down" | "arrow-up" | "arrow-down" | "check" | "file-text"
>;

type Props = SVGProps<SVGSVGElement> & { name: AdminIconName; size?: number };

export default function AdminIcon({ name, size = 18, ...props }: Props) {
  return <AppIcon name={name} size={size} {...props} />;
}
