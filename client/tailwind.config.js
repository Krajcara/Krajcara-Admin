/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#1A56A0',
          light:   '#2563EB',
          dark:    '#1e40af'
        }
      }
    }
  },
  plugins: []
}
