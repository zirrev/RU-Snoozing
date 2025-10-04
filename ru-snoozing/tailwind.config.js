/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'sans': ['Inter', 'Poppins', 'system-ui', 'sans-serif'],
      },
      colors: {
        'dark-bg': '#0b1220',
        'soft-white': '#eaf0ff',
      }
    },
  },
  plugins: [],
}
