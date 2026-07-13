import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      // Semantic tokens (ink = foreground ramp, surface = background ramp,
      // border, accent). Values resolve from CSS custom properties defined in
      // index.css, so light/dark flips there in one place and components keep
      // the same classnames. The rgb(var(--x) / <alpha-value>) form preserves
      // Tailwind opacity modifiers (e.g. bg-accent/70).
      colors: {
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          soft: 'rgb(var(--surface-soft) / <alpha-value>)',
          softer: 'rgb(var(--surface-softer) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          faint: 'rgb(var(--border-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          tint: 'rgb(var(--accent-tint) / <alpha-value>)',
          'tint-border': 'rgb(var(--accent-tint-border) / <alpha-value>)',
          deep: 'rgb(var(--accent-deep) / <alpha-value>)',
        },
      },
      letterSpacing: {
        tight: '-0.011em',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
} satisfies Config;
