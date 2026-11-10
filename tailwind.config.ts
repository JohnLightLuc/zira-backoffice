import type { Config } from "tailwindcss";

// Every colour points at a --zira-* variable from src/styles/tokens.css,
// so Tailwind utilities and the component classes share one source.
const v = (name: string) => `var(--zira-${name})`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: v("primary"), hover: v("primary-hover"), soft: v("primary-soft") },
        accent: { DEFAULT: v("accent"), hover: v("accent-hover"), soft: v("accent-soft") },
        background: v("background"),
        surface: { DEFAULT: v("surface"), muted: v("surface-muted") },
        border: { DEFAULT: v("border"), strong: v("border-strong") },
        ink: { DEFAULT: v("text-primary"), secondary: v("text-secondary"), disabled: v("text-disabled") },
        status: {
          active: v("status-active"), "active-soft": v("status-active-soft"), "active-ink": v("status-active-ink"),
          maintenance: v("status-maintenance"), "maintenance-soft": v("status-maintenance-soft"), "maintenance-ink": v("status-maintenance-ink"),
          inactive: v("status-inactive"), "inactive-soft": v("status-inactive-soft"), "inactive-ink": v("status-inactive-ink"),
          available: v("status-available"), "available-soft": v("status-available-soft"), "available-ink": v("status-available-ink"),
        },
      },
      fontFamily: { sans: ["var(--font-sans)"], mono: ["var(--font-mono)"] },
      borderRadius: { sm: v("radius-sm"), md: v("radius-md"), lg: v("radius-lg"), pill: v("radius-pill") },
      boxShadow: { card: v("shadow-card"), overlay: v("shadow-overlay") },
      spacing: { sidebar: v("sidebar-width"), header: v("header-height") },
      maxWidth: { content: v("content-max") },
    },
  },
  plugins: [],
} satisfies Config;
