/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#08080b", 900: "#0e0e13", 800: "#15151c", 700: "#1d1d27", 600: "#2a2a37", 500: "#3a3a4a" },
        violet: { glow: "#8b5cf6" },
        azure: { glow: "#3b82f6" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      keyframes: { fadeIn: { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } } },
      animation: { fadeIn: "fadeIn .25s ease-out" },
    },
  },
  plugins: [],
};
