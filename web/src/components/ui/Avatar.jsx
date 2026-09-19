import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

/**
 * Avatar. Falls back to initials on a token-coloured disc, so a member or user
 * without a photo still looks deliberate rather than broken.
 */
const SIZES = {
  xs: 'h-6 w-6 text-[0.625rem]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-9.5 w-9.5 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-xl',
};

export function Avatar({ src, name, size = 'md', className, square = false, ring = false }) {
  const dimension = SIZES[size] || SIZES.md;
  const shape = square ? 'rounded' : 'rounded-full';

  if (src) {
    return (
      <img
        src={src}
        alt={name ? `${name} avatar` : 'Avatar'}
        loading="lazy"
        className={cn(
          'shrink-0 bg-surface-alt object-cover',
          dimension,
          shape,
          ring && 'ring-2 ring-surface',
          className,
        )}
        onError={(event) => {
          // A dead image URL should degrade to initials, not show a broken icon.
          event.currentTarget.style.display = 'none';
        }}
      />
    );
  }

  return (
    <span
      aria-hidden={!name}
      title={name || undefined}
      className={cn(
        'grid shrink-0 select-none place-items-center bg-primary-soft font-semibold text-primary',
        dimension,
        shape,
        ring && 'ring-2 ring-surface',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export default Avatar;
