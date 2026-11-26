import type { SVGProps } from "react";

export type AdminIconName =
  | "home" | "railway" | "clock" | "megaphone" | "users"
  | "activity" | "chart" | "trash" | "pencil" | "pause"
  | "play" | "plus" | "x" | "arrow-up-right" | "arrow-right"
  | "arrow-up-down" | "arrow-up" | "arrow-down" | "check" | "file-text";

type Props = SVGProps<SVGSVGElement> & { name: AdminIconName; size?: number };

export default function AdminIcon({ name, size = 18, ...props }: Props) {
  const paths: Record<AdminIconName, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></>,
    railway: <><rect x="5" y="3" width="14" height="17" rx="3" /><path d="M8 7h8M8 12h.01M16 12h.01M8 20l-2 2m10-2 2 2M8 16h8" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    megaphone: <><path d="m3 11 18-5v12L3 13z" /><path d="M11 15.2 13 21H8l-2-7.1M21 10v4" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    activity: <><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-5 5" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></>,
    pencil: <><path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    play: <><path d="m7 4 13 8-13 8z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    x: <><path d="m18 6-12 12M6 6l12 12" /></>,
    "arrow-up-right": <><path d="M7 17 17 7M7 7h10v10" /></>,
    "arrow-right": <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    "arrow-up-down": <><path d="m8 7 4-4 4 4M12 3v18m-4-4 4 4 4-4" /></>,
    "arrow-up": <><path d="m7 14 5-5 5 5" /></>,
    "arrow-down": <><path d="m7 10 5 5 5-5" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    "file-text": <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {paths[name]}
    </svg>
  );
}
