import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          DEFAULT: '#111318',
          muted: '#374151',
          soft: '#6B7280',
          faint: '#9CA3AF',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#FAFBFC',
          softer: '#F7F8FA',
          sunken: '#F4F5F7',
        },
        border: {
          DEFAULT: '#E5E7EB',
          faint: '#EEF0F3',
        },
        accent: {
          DEFAULT: '#5B6AFF',
          tint: '#EEF0FF',
          'tint-border': '#DCE1FF',
          deep: '#1E2A8C',
        },
      },
      letterSpacing: {
        tight: '-0.011em',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
