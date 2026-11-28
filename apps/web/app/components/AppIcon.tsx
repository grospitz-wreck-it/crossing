"use client";
import {
  Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  ArrowUpDown, ArrowUpRight, Bell, BookOpen, CalendarDays, Check, ChevronDown,
  ChevronLeft, ChevronRight, ChevronUp, Clock3, Frown, Fuel, Gauge, Handshake, Home,
  Info, Lightbulb, Laugh, Map, MapPin, Meh, Menu, Megaphone, MessageCircle, MoreHorizontal,
  Newspaper,
  Navigation, Pause, Pencil, Play, Plus, RefreshCw, Route, Search, Settings,
  ShieldCheck, Smile, Sparkles, ThumbsDown, ThumbsUp, TrainFront, Trash2, Users, X,
  FileText, ChartNoAxesCombined, type LucideIcon,
} from "lucide-react";
import type { SVGProps } from "react";
const icons = {
  home: Home, railway: TrainFront, train: TrainFront, clock: Clock3,
  megaphone: Megaphone, users: Users, activity: Activity, chart: ChartNoAxesCombined,
  trash: Trash2, pencil: Pencil, pause: Pause, play: Play,
  plus: Plus, x: X, "arrow-up-right": ArrowUpRight, "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft, "arrow-up-down": ArrowUpDown, "arrow-up": ArrowUp,
  "arrow-down": ArrowDown, check: Check, "file-text": FileText, menu: Menu,
  fuel: Fuel, map: Map, "map-pin": MapPin, navigation: Navigation,
  route: Route, search: Search, settings: Settings, bell: Bell,
  calendar: CalendarDays, refresh: RefreshCw, "chevron-down": ChevronDown,
  "chevron-up": ChevronUp, "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight, alert: AlertTriangle, info: Info,
  "shield-check": ShieldCheck, "message-circle": MessageCircle,
  "book-open": BookOpen, "lightbulb": Lightbulb, "laugh": Laugh, "newspaper": Newspaper,
  "handshake": Handshake, "smile": Smile, "meh": Meh, "frown": Frown,
  "thumbs-up": ThumbsUp, "thumbs-down": ThumbsDown, "sparkles": Sparkles,
} satisfies Record<string, LucideIcon>;
export type AppIconName = keyof typeof icons;
type Props = Omit<SVGProps<SVGSVGElement>, "name"> & { name: AppIconName; size?: number; strokeWidth?: number };
export default function AppIcon({ name, size = 20, strokeWidth = 1.8, ...props }: Props) {
  const Icon = icons[name];
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" {...props} />;
}
