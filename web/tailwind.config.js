/**
 * Tailwind is wired to the design tokens the theme engine writes onto
 * :root as CSS variables. Business components therefore say `bg-surface`,
 * `text-muted` or `border-border` and never a literal colour, which is what
 * lets one codebase render as many different brands.
 *
 * Note: because the tokens are CSS variables, Tailwind's opacity modifier
 * syntax (`bg-primary/10`) cannot compute an alpha channel. Use the `*-soft`
 * tokens the engine already emits for tinted backgrounds.
 */
/**
 * Tailwind 3 only ships half steps up to 3.5. The design system uses a
 * consistent half-step rhythm (4.5, 5.5, 9.5...), so extend the scale rather
 * than scattering arbitrary values through components.
 */
const HALF_STEPS = Object.fromEntries(
  Array.from({ length: 40 }, (_, i) => i + 0.5)
    .filter((n) => ![0.5, 1.5, 2.5, 3.5].includes(n))
    .map((n) => [String(n), `${n * 0.25}rem`]),
);

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: 'var(--color-primary)', fg: 'var(--color-primary-fg)', hover: 'var(--color-primary-hover)', soft: 'var(--color-primary-soft)' },
        secondary: { DEFAULT: 'var(--color-secondary)', fg: 'var(--color-secondary-fg)' },
        accent: { DEFAULT: 'var(--color-accent)', fg: 'var(--color-accent-fg)' },
        background: 'var(--color-background)',
        surface: { DEFAULT: 'var(--color-surface)', alt: 'var(--color-surface-alt)' },
        input: 'var(--color-input-bg)',
        border: 'var(--color-border)',
        foreground: 'var(--color-text)',
        muted: 'var(--color-muted-text)',
        success: { DEFAULT: 'var(--color-success)', soft: 'var(--color-success-soft)' },
        warning: { DEFAULT: 'var(--color-warning)', soft: 'var(--color-warning-soft)' },
        danger: { DEFAULT: 'var(--color-error)', soft: 'var(--color-error-soft)' },
        info: { DEFAULT: 'var(--color-info)', soft: 'var(--color-info-soft)' },
        sidebar: {
          DEFAULT: 'var(--color-sidebar-bg)',
          fg: 'var(--color-sidebar-fg)',
          active: 'var(--color-sidebar-active-bg)',
          'active-fg': 'var(--color-sidebar-active-fg)',
        },
        navbar: 'var(--color-navbar-bg)',
        ring: 'var(--color-ring)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        heading: 'var(--font-heading)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
      spacing: {
        sidebar: 'var(--sidebar-width)',
        ...HALF_STEPS,
      },
      fontSize: {
        // Scaled by the tenant's typography setting.
        base: 'calc(0.9375rem * var(--font-scale))',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
