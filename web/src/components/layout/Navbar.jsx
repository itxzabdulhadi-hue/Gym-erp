import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, Moon, Search, Sun, User, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/Avatar';
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/Dropdown';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * Top bar: page identity, global search entry, notifications and the account
 * menu. Sits above the content on desktop and becomes the only chrome on a
 * phone, where navigation moves to the bottom bar.
 */
export function Navbar({ title, onOpenSidebar, unreadCount = 0, onOpenSearch }) {
  const { user, tenant, logout, logoutEverywhere, can } = useAuth();
  const { theme, setMode, resolvedMode } = useTheme();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const sticky = theme?.layout?.navbarStyle !== 'static';
  const navbarStyle = theme?.appearance?.navbarStyle || 'solid';
  const isDark = resolvedMode === 'dark';

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header
      className={cn(
        'z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-navbar px-3 sm:px-4',
        sticky && 'sticky top-0',
        navbarStyle === 'glass' && 'bg-[color-mix(in_srgb,var(--color-navbar-bg)_88%,transparent)] backdrop-blur-xl',
        navbarStyle === 'bordered' && 'border-b-2',
      )}
    >
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
        className="grid h-9 w-9 shrink-0 place-items-center rounded text-muted transition-colors hover:bg-surface-alt hover:text-foreground lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[0.9375rem] font-semibold text-foreground">{title}</h1>
        {tenant?.name && (
          <p className="hidden truncate text-[0.6875rem] text-muted sm:block">{tenant.name}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        className="hidden h-9 items-center gap-2 rounded border border-border bg-surface-alt px-2.5 text-sm text-muted transition-colors hover:border-ring hover:text-foreground md:flex"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
        <span className="pr-6">Search…</span>
        <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[0.625rem] font-medium">/</kbd>
      </button>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search"
        className="grid h-9 w-9 place-items-center rounded text-muted transition-colors hover:bg-surface-alt hover:text-foreground md:hidden"
      >
        <Search className="h-4.5 w-4.5" />
      </button>

      <button
        type="button"
        onClick={() => setMode(isDark ? 'light' : 'dark')}
        aria-label={isDark ? 'Switch to light appearance' : 'Switch to dark appearance'}
        className="grid h-9 w-9 place-items-center rounded text-muted transition-colors hover:bg-surface-alt hover:text-foreground"
      >
        {isDark ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
      </button>

      <button
        type="button"
        onClick={() => navigate('/notifications')}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        className="relative grid h-9 w-9 place-items-center rounded text-muted transition-colors hover:bg-surface-alt hover:text-foreground"
      >
        <Bell className="h-4.5 w-4.5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.5625rem] font-bold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <Dropdown
        ariaLabel="Account menu"
        trigger={
          <span className="flex items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-surface-alt">
            <Avatar src={user?.avatarUrl} name={user?.fullName || user?.email} size="sm" />
            <span className="hidden text-left lg:block">
              <span className="block max-w-[9rem] truncate text-xs font-medium text-foreground">
                {user?.fullName || user?.email}
              </span>
              <span className="block text-[0.6875rem] capitalize text-muted">
                {user?.isPlatformAdmin ? 'Platform admin' : 'Signed in'}
              </span>
            </span>
          </span>
        }
      >
        <DropdownLabel>{user?.email}</DropdownLabel>
        <DropdownItem icon={User} onClick={() => navigate('/settings/profile')}>
          My profile
        </DropdownItem>
        {can('users.view') && (
          <DropdownItem icon={Users} onClick={() => navigate('/users')}>
            Manage users
          </DropdownItem>
        )}
        <DropdownSeparator />
        <DropdownItem
          icon={LogOut}
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </DropdownItem>
        {can('auth.sessions') && (
          <DropdownItem icon={LogOut} tone="danger" onClick={logoutEverywhere}>
            Sign out everywhere
          </DropdownItem>
        )}
      </Dropdown>
    </header>
  );
}

export default Navbar;
