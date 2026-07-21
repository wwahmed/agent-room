import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      // T-39 / T-38a: the fixed editorial scale. Use these names instead of
      // inventing responsive arbitrary pixel values in individual screens.
      fontSize: {
        caption: ['12px', { lineHeight: '1.45' }],
        meta: ['13px', { lineHeight: '1.45' }],
        body: ['15px', { lineHeight: '1.6' }],
        title: ['17px', { lineHeight: '1.35' }],
        heading: ['20px', { lineHeight: '1.25' }],
        display: ['24px', { lineHeight: '1.2' }],
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
          0: 'rgb(var(--surface-0) / <alpha-value>)',
          1: 'rgb(var(--surface-1) / <alpha-value>)',
          2: 'rgb(var(--surface-2) / <alpha-value>)',
          soft: 'rgb(var(--surface-soft) / <alpha-value>)',
          softer: 'rgb(var(--surface-softer) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          faint: 'rgb(var(--border-faint) / <alpha-value>)',
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          tint: 'rgb(var(--accent-tint) / <alpha-value>)',
          'tint-border': 'rgb(var(--accent-tint-border) / <alpha-value>)',
          deep: 'rgb(var(--accent-deep) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          tint: 'rgb(var(--success-tint) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
          tint: 'rgb(var(--warning-tint) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          tint: 'rgb(var(--danger-tint) / <alpha-value>)',
        },
      },
      spacing: {
        'icon-sm': '16px',
        icon: '20px',
        related: '8px',
        grouped: '12px',
        section: '24px',
        screen: '16px',
        'screen-desktop': '24px',
      },
      borderRadius: {
        control: '8px',
        card: '12px',
        sheet: '16px',
      },
      letterSpacing: {
        tight: '-0.011em',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        elevated: 'var(--shadow-elevated)',
      },
      transitionDuration: {
        micro: '150ms',
        panel: '250ms',
      },
      transitionTimingFunction: {
        product: 'cubic-bezier(0.2, 0, 0, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
