import type { Config } from "tailwindcss";

// Tailwind 与 AntD 共存：色板对齐 theme.ts 中的 token，避免视觉冲突
export default {
  content: {
    relative: true,
    files: ["./index.html", "./src/**/*.{ts,tsx}"],
  },
  // 关闭 Tailwind 的 preflight，避免与 AntD 静态样式冲突
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // 产品主强调色：克制的暖金
        brand: {
          50: "#fbf7f0",
          100: "#f5ead8",
          200: "#ecd4ad",
          300: "#dfb977",
          400: "#ca984f",
          500: "#b88746",
          600: "#966a36",
          700: "#78512d",
          800: "#604127",
          900: "#4e3622",
        },
        // 中性灰阶，对齐 AntD neutral
        ink: {
          50: "#fafafa",
          100: "#f5f5f5",
          200: "#e5e5e5",
          300: "#d4d4d4",
          400: "#a3a3a3",
          500: "#737373",
          600: "#525252",
          700: "#404040",
          800: "#262626",
          900: "#171717",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'Inter'",
          "'PingFang SC'",
          "'Microsoft YaHei'",
          "sans-serif",
        ],
        mono: ["'JetBrains Mono'", "'SF Mono'", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        // 极轻阴影，SaaS 卡片典型用法
        card: "0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02)",
        "card-hover":
          "0 4px 12px -2px rgba(0, 0, 0, 0.06), 0 2px 6px -1px rgba(0, 0, 0, 0.04)",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
      },
    },
  },
  plugins: [],
} satisfies Config;
