import { useMemo } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CreditCard,
  Fingerprint,
  Info,
  Lock,
  Palette,
  Puzzle,
  ScrollText,
  ShieldCheck,
  Sliders,
  User,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Settings shell.
 *
 * A nested layout: the section list on the left, the section itself on the
 * right. Only sections the caller has permission for are listed, so a
 * receptionist sees two entries where an owner sees eleven - the same rule the
 * API enforces, applied to the menu instead of to the data.
 */

const SECTIONS = [
  { to: '/settings', key: 'general', label: 'General', icon: Info, end: true, permission: ['settings.view'] },
  { to: '/settings/branding', key: 'branding', label: 'Branding', icon: Sliders, permission: ['branding.view'] },
  { to: '/settings/theme', key: 'theme', label: 'Theme Studio', icon: Palette, permission: ['theme.view'] },
  { to: '/settings/modules', key: 'modules', label: 'Modules', icon: Puzzle, permission: ['settings.view'] },
  { to: '/settings/users', key: 'users', label: 'Users', icon: Users, permission: ['users.view'] },
  { to: '/settings/roles', key: 'roles', label: 'Roles & permissions', icon: ShieldCheck, permission: ['roles.view'] },
  { to: '/settings/notifications', key: 'notifications', label: 'Notifications', icon: Bell, permission: ['settings.view'] },
  { to: '/settings/membership', key: 'membership', label: 'Membership', icon: CreditCard, permission: ['settings.view'] },
  { to: '/settings/attendance', key: 'attendance', label: 'Attendance', icon: Fingerprint, permission: ['settings.view'] },
  { to: '/settings/payments', key: 'payments', label: 'Payments', icon: CreditCard, permission: ['settings.view'] },
  { to: '/settings/security', key: 'security', label: 'Security', icon: Lock, permission: ['settings.view'] },
  { to: '/settings/audit', key: 'audit', label: 'Audit log', icon: ScrollText, permission: ['audit.view'] },
  { to: '/settings/profile', key: 'profile', label: 'My profile', icon: User },
];

export function SettingsPage() {
  const { can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const visible = useMemo(() => SECTIONS.filter((s) => !s.permission || can(s.permission)), [can]);

  const current =
    visible.find((s) => s.to === location.pathname) ||
    visible.find((s) => !s.end && location.pathname.startsWith(s.to));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Configure how this business looks and behaves"
      />

      <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-[4.5rem] lg:self-start">
          <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {visible.map((section) => {
              const Icon = section.icon;
              const active = current?.key === section.key;
              return (
                <li key={section.key} className="shrink-0 lg:w-full">
                  <NavLink
                    to={section.to}
                    end={section.end}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary-soft text-primary'
                        : 'text-muted hover:bg-surface-alt hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="whitespace-nowrap">{section.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          <Outlet context={{ navigate }} />
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
