/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'ucl-navy': '#0a0f1e',
        'ucl-blue': '#1a3a6b',
        'ucl-light': '#4a90d9',
        'ucl-gold': '#c9a227',
        'ucl-gold-light': '#f0d060',
        /* keep old names as aliases so nothing breaks */
        'premier-purple': '#1a3a6b',
        'premier-pink': '#c9a227',
        'premier-cyan': '#4a90d9',
      },
      backgroundImage: {
        'gradient-main': 'linear-gradient(135deg, #1a3a6b 0%, #c9a227 100%)',
        'gradient-hero': 'linear-gradient(135deg, #4a90d9 0%, #1a3a6b 50%, #c9a227 100%)',
      },
    },
  },
  plugins: [],
}
