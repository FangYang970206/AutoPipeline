import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(222 22% 9%)',
        foreground: 'hsl(210 28% 94%)',
        muted: 'hsl(220 14% 18%)',
        border: 'hsl(217 14% 24%)',
        accent: 'hsl(174 72% 42%)',
      },
    },
  },
  plugins: [],
};

export default config;
