import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BrandMark } from './BrandMark';

/**
 * Sidebar.
 *
 * Position, width and surface treatment all come from the tenant theme, so the
 * same component renders as a dark rail for one brand and a light glass panel
 * for another. On a phone it becomes an off-canvas drawer rather than a crushed
 * desktop rail.
 */
export function Sidebar({ sections, open, onClose, theme, branding, collapsed, onToggleCollapse }) {
  const position = theme?.layout?.sidebarPosition === 'right' ? 'right' : 'left';
  const style = theme?.appearance?.sidebarStyle || 'solid';
  const collapsible = theme?.layout?.sidebarCollapsible !== false;

  return (
    <>
      {/* Scrim, mobile only */}
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/45 transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        id="app-sidebar"
        className={cn(
          'fixed inset-y-0 z-40 flex w-[var(--sidebar-width)] max-w-[85vw] flex-col bg-sidebar text-sidebar-fg',
          'transition-transform duration-250 ease-smooth lg:translate-x-0',
          position === 'right' ? 'right-0' : 'left-0',
          open ? 'translate-x-0' : position === 'right' ? 'translate-x-full' : '-translate-x-full',
          style === 'glass' && 'bg-[color-mix(in_srgb,var(--color-sidebar-bg)_92%,transparent)] backdrop-blur-xl',
          collapsed && 'lg:w-[4.5rem]',
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3.5">
          <BrandMark branding={branding} collapsed={collapsed} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid h-8 w-8 place-items-center rounded text-sidebar-fg transition-colors hover:bg-white/10 lg:hidden"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" onClick={onClose}>
          {sections.map((section) => (
            <div key={section.group || 'primary'} className="mb-4 last:mb-0">
              {section.group && !collapsed && (
                <p className="mb-1.5 px-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.09em] text-sidebar-fg opacity-60">
                  {section.group}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isExact = item.to === '/';
                  return (
                    <li key={item.key}>
                      <NavLink
                        to={item.to}
                        end={isExact}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'group flex items-center gap-2.5 rounded px-2.5 py-2 text-sm font-medium transition-colors duration-150',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                            isActive
                              ? 'bg-sidebar-active text-sidebar-active-fg'
                              : 'text-sidebar-fg hover:bg-white/8 hover:text-white',
                            collapsed && 'justify-center px-0',
                          )
                        }
                      >
                        {Icon && <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />}
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {collapsible && (
          <div className="hidden shrink-0 border-t border-white/10 p-2 lg:block">
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              className="flex w-full items-center justify-center gap-2 rounded px-2.5 py-2 text-xs text-sidebar-fg transition-colors hover:bg-white/8 hover:text-white"
            >
              <svg
                className={cn('h-4 w-4 transition-transform duration-200', collapsed && 'rotate-180')}
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path d="m12 5-5 5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

export default Sidebar;
