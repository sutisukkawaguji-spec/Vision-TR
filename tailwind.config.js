/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './app.js', './dashboard.html', './dashboard.js'],
  theme: {
    extend: {
      colors: {
        gray: { 150: '#e5e7eb', 650: '#4b5563', 850: '#1f2937' },
        blue: { 650: '#1d4ed8' },
        red: { 150: '#fee2e2', 650: '#dc2626' },
      },
    },
  },
  plugins: [],
};
