import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { MobileNav } from '@/components/layout/MobileNav';
import { visibleNavigation, MOBILE_NAV_KEYS } from '@/app/navigation';
import { terminologyFor } from '@/services/branding.api';
import notificationsApi from '@/services/notifications.api';
import { queryKeys } from '@/lib/queryClient';

/**
 * The application shell.
 *
 * Owns the chrome only - no page content. Navigation is computed from the
 * tenant's enabled modules and the caller's permissions, and the same computed
 * list feeds the sidebar and the mobile bar.
 */

const SIDEBAR_COLLAPSED_KEY = 'erp.sidebar.collapsed';

export function AppLayout() {
  const { branding, moduleEnabled, can } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const terminology = useMemo(() => terminologyFor(branding), [branding]);

  const sections = useMemo(
    () => visibleNavigation({ moduleEnabled, can, terminology }),
    [moduleEnabled, can, terminology],
  );

  const mobileItems = useMemo(
    () =>
      sections
        .flatMap((s) => s.items)
        .filter((item) => MOBILE_NAV_KEYS.includes(item.key))
        .slice(0, 5),
    [sections],
  );

  // Close the drawer whenever the route changes, so navigating on a phone does
  // not leave the menu covering the page you just arrived at.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable is not fatal */
      }
      return next;
    });
  };

  // Unread count drives the navbar bell and the mobile badge.
  const { data: notifications } = useQuery({
    queryKey: queryKeys.notifications({ unread: true }),
    queryFn: () => notificationsApi.list({ unread: true, limit: 20 }),
    refetchInterval: 60_000,
    enabled: can('notifications.view'),
  });
  const unread = notifications?.meta?.total ?? (Array.isArray(notifications) ? notifications.length : 0);

  const position = theme?.layout?.sidebarPosition === 'right' ? 'right' : 'left';
  const contentWidth = theme?.layout?.contentWidth || 'wide';
  const widthClass =
    contentWidth === 'boxed' ? 'max-w-5xl' : contentWidth === 'full' ? 'max-w-none' : 'max-w-[100rem]';

  const currentTitle = useMemo(() => {
    const flat = sections.flatMap((s) => s.items);
    const match = flat
      .slice()
      .sort((a, b) => b.to.length - a.to.length)
      .find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));
    return match?.label || branding?.appName || 'Dashboard';
  }, [sections, location.pathname, branding]);

  return (
    <div className="min-h-dvh bg-background">
      <Sidebar
        sections={sections}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        theme={theme}
        branding={branding}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      <div
        className={cn(
          'flex min-h-dvh flex-col transition-[padding] duration-250 ease-smooth',
          // Only desktop reserves room for the rail; on a phone it is an overlay.
          position === 'right' ? 'lg:pr-[var(--sidebar-width)]' : 'lg:pl-[var(--sidebar-width)]',
          collapsed && (position === 'right' ? 'lg:pr-[4.5rem]' : 'lg:pl-[4.5rem]'),
        )}
      >
        <Navbar
          title={currentTitle}
          onOpenSidebar={() => setSidebarOpen(true)}
          unreadCount={unread}
          onOpenSearch={() => setSidebarOpen(true)}
        />

        <main
          className="mx-auto w-full flex-1 px-3 pb-[calc(var(--bottom-nav-height)+1rem)] pt-4 sm:px-5 lg:pb-6"
          id="main-content"
        >
          <div className={cn('mx-auto w-full', widthClass)}>
            <Outlet />
          </div>
        </main>
      </div>

      <MobileNav items={mobileItems} badgeFor={(key) => (key === 'notifications' ? unread : 0)} />
    </div>
  );
}

export default AppLayout;
