import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      // Dark theme. The app is written against semantic tokens (ink =
      // foreground ramp, surface = background ramp, border, accent), so the
      // theme flips here in one place; components keep the same classnames.
      colors: {
        ink: {
          DEFAULT: '#E8EBF1',
          muted: '#C3C9D4',
          soft: '#98A1B0',
          faint: '#6E7787',
        },
        surface: {
          DEFAULT: '#161B24',
          soft: '#131822',
          softer: '#10141D',
          sunken: '#0B0F16',
        },
        border: {
          DEFAULT: '#2A3140',
          faint: '#1F2531',
        },
        accent: {
          DEFAULT: '#6D7BFF',
          tint: '#202749',
          'tint-border': '#3A4380',
          deep: '#B9C1FF',
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
