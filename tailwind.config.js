/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.js'],
  safelist: [
    { pattern: /(bg|border|text|ring)-(emerald|sky|red|amber|violet|rose|gray|ink)-(100|200|300|400|500|600|700|800|850|900|950)(\/(10|15|20|25|30|40|50|60|70|80|90))?/ },
  ],
  theme: {
    extend: {
      colors: {
        ink: Object.fromEntries(['950', '900', '850', '800', '700', '600', '500', '400', '300', '200', '100'].map(k => [k, `rgb(var(--ink-${k}) / <alpha-value>)`])),
        white: 'rgb(var(--fg) / <alpha-value>)',
        paper: '#ffffff',
        night: '#07090d',
        felt: { DEFAULT: '#0f5a38', dark: '#0a4029', light: '#16774b' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'Inter', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"SF Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.35), 0 4px 12px rgba(0,0,0,.25)',
        lift: '0 8px 30px rgba(0,0,0,.35)',
      },
    },
  },
  plugins: [],
};
