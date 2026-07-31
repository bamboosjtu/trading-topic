import type { Config } from "tailwindcss";
import { BRAND, BRAND_STRONG } from "./src/colors";

// Tailwind 与 AntD 共用同一套冷蓝 / 墨蓝语义色。
// brand-strong 对应 DESIGN_SYSTEM.md 中的主动作强调色，与 brand.600 同值，
// 显式命名为 token 供 `text-brand-strong` / `bg-brand-strong` 等工具类引用。
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
        brand: {
          50: "#edf5ff",
          100: "#dbeafe",
          500: BRAND,
          600: BRAND_STRONG,
          700: "#0953ad",
          // 显式 token，供需要语义命名的位置引用，避免散落硬编码色值。
          strong: BRAND_STRONG,
        },
        surface: {
          canvas: "#f6f8fb",
          panel: "#ffffff",
          muted: "#f8fafc",
        },
        text: {
          strong: "#112543",
          DEFAULT: "#1e3554",
          muted: "#5d6f87",
        },
        stroke: {
          DEFAULT: "#dfe6ef",
          soft: "#edf1f6",
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
        card: "0 1px 2px rgba(20, 42, 76, 0.03), 0 8px 24px -18px rgba(20, 42, 76, 0.18)",
        "card-hover":
          "0 2px 4px -1px rgba(20, 42, 76, 0.05), 0 12px 32px -16px rgba(20, 42, 76, 0.24)",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
      },
    },
  },
  plugins: [],
} satisfies Config;
