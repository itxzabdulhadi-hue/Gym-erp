import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/Avatar';

/**
 * The tenant's mark in the chrome. Uses their uploaded logo when there is one
 * and falls back to their own initials and palette colour when there is not, so
 * an unconfigured tenant still sees their name rather than ours.
 */
export function BrandMark({ branding, collapsed = false, className, showTagline = false }) {
  const name = branding?.businessName || branding?.appName || 'Workspace';
  const short = branding?.shortName || name;
  const logo = branding?.logoUrl || branding?.logoLightUrl;

  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      {logo ? (
        <img
          src={logo}
          alt={name}
          className={cn('shrink-0 object-contain', collapsed ? 'h-7 w-7' : 'h-8 w-8')}
        />
      ) : (
        <span
          className={cn(
            'grid shrink-0 place-items-center rounded bg-white/12 text-[0.6875rem] font-bold text-white',
            collapsed ? 'h-7 w-7' : 'h-8 w-8',
          )}
          aria-hidden="true"
        >
          {String(short).slice(0, 2).toUpperCase()}
        </span>
      )}
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">{name}</span>
          {showTagline && branding?.tagline && (
            <span className="block truncate text-[0.6875rem] text-sidebar-fg opacity-75">{branding.tagline}</span>
          )}
        </span>
      )}
    </div>
  );
}

/** Light-surface variant for the login screen and empty states. */
export function BrandMarkLight({ branding, size = 'md', className }) {
  const name = branding?.businessName || branding?.appName || 'Workspace';
  const short = branding?.shortName || name;
  const logo = branding?.loginLogoUrl || branding?.logoUrl || branding?.logoLightUrl;
  const dimension = { sm: 'h-9 w-9', md: 'h-11 w-11', lg: 'h-14 w-14' }[size] || 'h-11 w-11';

  if (logo) {
    return <img src={logo} alt={name} className={cn('object-contain', dimension, className)} />;
  }

  return (
    <Avatar
      name={short}
      src={null}
      square
      className={cn(dimension, 'rounded-lg bg-primary text-primary-fg', className)}
    />
  );
}

export default BrandMark;
