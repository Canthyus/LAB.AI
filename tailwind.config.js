/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#07090d", 900: "#0b0e14", 800: "#11151d", 700: "#181d28", 600: "#252c3a", 500: "#36405a" },
        lab: { DEFAULT: "#22d3ee", dim: "#0e7490" },
        violet: { glow: "#8b5cf6" },
        azure: { glow: "#3b82f6" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"] },
      keyframes: { fadeIn: { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } } },
      animation: { fadeIn: "fadeIn .25s ease-out" },
    },
  },
  plugins: [],
};
