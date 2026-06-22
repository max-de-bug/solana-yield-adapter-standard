import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#14161b",
        surface2: "#1c1f26",
        border: "#2a2d35",
        muted: "#8b8f97",
        accent: "#6c5ce7",
        "accent-hover": "#7f6ff0",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
