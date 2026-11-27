import type { SVGProps } from "react";
import AppIcon, { type AppIconName } from "../../components/AppIcon";

export type AdminIconName = AppIconName;

type Props = Omit<SVGProps<SVGSVGElement>, "name" | "strokeWidth"> & {
  name: AdminIconName;
  size?: number;
  strokeWidth?: number;
};

export default function AdminIcon({ name, size = 18, ...props }: Props) {
  return <AppIcon name={name} size={size} {...props} />;
}
