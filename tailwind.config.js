/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        canvas: '#f4f6f3',
        panel: '#ffffff',
        accent: '#0f766e',
        accentSoft: '#ccfbf1',
        amber: '#b45309',
        danger: '#b91c1c'
      },
      fontFamily: {
        sans: ['"Microsoft YaHei"', '"PingFang SC"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Code"', 'Consolas', 'monospace']
      },
      boxShadow: {
        panel: '0 1px 2px rgba(16,24,40,.04), 0 12px 30px rgba(16,24,40,.06)'
      }
    }
  },
  plugins: []
}
