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
        // 权威墨蓝：主按钮、链接、图表辅线、信息态
        navy: {
          50: "#f1f6fa",
          100: "#e2edf4",
          200: "#c2dae7",
          300: "#94bdd3",
          400: "#5e97b7",
          500: "#37799c",
          600: "#226186",
          700: "#174b6b",
          800: "#123a54",
          900: "#0d2c40",
          950: "#081e2e",
        },
        // 香槟金：导航选中、眉题、关键高亮（克制使用，不做大面积填充）
        gold: {
          50: "#fbf6eb",
          100: "#f6ebd2",
          200: "#edd7a9",
          300: "#e2c07e",
          400: "#d4a857",
          500: "#c79345",
          600: "#a97634",
          700: "#875c28",
          800: "#6b4820",
          900: "#543819",
        },
        // 暖瓷中性色：工作区底色、文本、描边（与金色系同温）
        ink: {
          50: "#faf8f4",
          100: "#f5f2eb",
          200: "#ece7db",
          300: "#dcd5c3",
          400: "#a39e8d",
          500: "#7b7668",
          600: "#5b574c",
          700: "#403d36",
          800: "#2b2925",
          900: "#1e1c18",
        },
        // 面板描边 / 细分隔线
        line: {
          DEFAULT: "#e6e0d2",
          soft: "#f0ebdf",
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
        // 暖调轻阴影：面板浮于瓷白工作区之上
        card: "0 1px 2px 0 rgba(69, 58, 33, 0.04), 0 8px 24px -16px rgba(69, 58, 33, 0.12)",
        "card-hover":
          "0 2px 4px -1px rgba(69, 58, 33, 0.05), 0 12px 32px -16px rgba(69, 58, 33, 0.18)",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
      },
    },
  },
  plugins: [],
} satisfies Config;
