import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        display: ['Newsreader', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      // Aurora theme (WakiDrive design language): warm near-black ground,
      // translucent glass panels, sky-cyan accent. Values track
      // WakiDrive/apps/mobile/src/theme/tokens.ts DARK palette.
      colors: {
        ink: {
          DEFAULT: '#f3f1f6',
          muted: '#c9c5d0',
          soft: '#8c8894',
          faint: '#6b6773',
        },
        surface: {
          DEFAULT: '#17151c',
          soft: '#121016',
          softer: '#0e0d12',
          sunken: '#0b0a0e',
        },
        border: {
          DEFAULT: 'rgba(255,255,255,0.11)',
          faint: 'rgba(255,255,255,0.06)',
        },
        accent: {
          DEFAULT: '#7dd3fc',
          tint: 'rgba(125,211,252,0.16)',
          'tint-border': 'rgba(125,211,252,0.35)',
          deep: '#bae6fd',
        },
        status: {
          good: '#4ade80',
          warn: '#f8a35c',
          bad: '#f87171',
        },
      },
      letterSpacing: {
        tight: '-0.011em',
      },
      borderRadius: {
        // Aurora shape scale (SHAPE.radius 26); all existing rounded-xl/2xl
        // classnames pick these up.
        xl: '18px',
        '2xl': '26px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
} satisfies Config;
