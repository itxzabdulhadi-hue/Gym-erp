import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * Bottom navigation for phones.
 *
 * A sidebar is not a mobile pattern - it needs a tap to open and hides the
 * primary destinations behind a drawer. This gives the five most used screens
 * a permanent thumb-reachable home, and reuses the same permission and module
 * filtering as the sidebar so the two can never disagree.
 */
export function MobileNav({ items, badgeFor }) {
  if (!items.length) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--bottom-nav-height)] items-stretch border-t border-border bg-navbar pb-safe lg:hidden"
      aria-label="Primary"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const badge = badgeFor?.(item.key) || 0;
        const isExact = item.to === '/';
        return (
          <NavLink
            key={item.key}
            to={item.to}
            end={isExact}
            className={({ isActive }) =>
              cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors',
                isActive ? 'text-primary' : 'text-muted',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" aria-hidden="true" />
                )}
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {badge > 0 && (
                    <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
                  )}
                </span>
                <span className="max-w-full truncate px-1 text-[0.625rem] font-medium leading-none">
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

export default MobileNav;
