/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        green: {
          brand: '#16A34A',
          light: '#DCFCE7',
          muted: '#BBF7D0',
        },
        orange: {
          brand: '#F97316',
          light: '#FFEDD5',
        },
        mp: '#009EE3',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
