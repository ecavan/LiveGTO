/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.js'],
  safelist: [
    { pattern: /(bg|border|text|ring)-(emerald|sky|red|amber|violet|rose|gray|ink)-(200|300|400|500|600|700|800|900|950)(\/(10|15|20|25|30|40|50|60))?/ },
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07090d', 900: '#0c1016', 850: '#10151d', 800: '#151b25', 700: '#1d2531',
          600: '#2a3442', 500: '#3b4757', 400: '#5d6a7c', 300: '#8793a4', 200: '#b4bdc9', 100: '#dde3ea',
        },
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
