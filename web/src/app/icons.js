import {
  LayoutDashboard,
  Users,
  CreditCard,
  Fingerprint,
  Dumbbell,
  ClipboardList,
  TrendingUp,
  Banknote,
  Receipt,
  BarChart3,
  UserCog,
  ShieldCheck,
  Bell,
  ScrollText,
  Settings,
  Box,
} from 'lucide-react';

/**
 * The module registry in @erp/shared names its icons as strings so the same
 * catalogue can drive the API, the database seed and the UI. This map resolves
 * those names to components - one place to add an icon, never per page.
 */
export const ICONS = {
  LayoutDashboard,
  Users,
  CreditCard,
  Fingerprint,
  Dumbbell,
  ClipboardList,
  TrendingUp,
  Banknote,
  Receipt,
  BarChart3,
  UserCog,
  ShieldCheck,
  Bell,
  ScrollText,
  Settings,
  Box,
};

export function moduleIcon(name) {
  return ICONS[name] || Box;
}

export default ICONS;
