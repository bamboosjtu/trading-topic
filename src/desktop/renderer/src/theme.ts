import type { ThemeConfig } from "antd";

/**
 * 现代 SaaS 视觉风格基线（攒股收息 R1）。
 *
 * 设计取向：
 * - 浅色背景为主，深色文字保证可读性；
 * - 单一品牌色（沉稳深绿），象征收益与稳定，区别于消费类应用的红蓝；
 * - 圆角 8-12px，卡片化布局，极轻阴影；
 * - 字号层级清晰，数字使用等宽字体强化金融工具感。
 *
 * 与 Tailwind 配色对齐：见 tailwind.config.ts 中的 brand / ink 色板。
 */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: "#15803d", // brand.600
    colorInfo: "#15803d",
    colorSuccess: "#16a34a",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    colorTextBase: "#171717", // ink.900
    colorBgBase: "#ffffff",
    colorBorder: "#e5e5e5", // ink.200
    colorBorderSecondary: "#f5f5f5", // ink.100
    colorBgLayout: "#fafafa", // ink.50
    colorBgContainer: "#ffffff",

    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,

    fontSize: 14,
    fontSizeLG: 16,
    fontSizeSM: 13,
    fontSizeXL: 20,
    fontSizeHeading1: 30,
    fontSizeHeading2: 24,
    fontSizeHeading3: 20,
    fontSizeHeading4: 18,
    fontSizeHeading5: 16,

    controlHeight: 32,
    controlHeightLG: 40,
    controlHeightSM: 24,

    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontFamilyCode:
      "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",

    wireframe: false,
    algorithm: undefined, // 使用默认算法（亮色）
  },
  components: {
    Layout: {
      headerBg: "#ffffff",
      headerHeight: 56,
      headerPadding: "0 24px",
      bodyBg: "#fafafa",
      siderBg: "#ffffff",
    },
    Menu: {
      itemSelectedBg: "#f0fdf5", // brand.50
      itemSelectedColor: "#15803d", // brand.600
      itemActiveBg: "#f0fdf5",
      itemHoverBg: "#f5f5f5",
    },
    Card: {
      borderRadiusLG: 12,
      boxShadowTertiary:
        "0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02)",
    },
    Table: {
      headerBg: "#fafafa",
      headerColor: "#525252",
      rowHoverBg: "#f5f5f5",
      cellPaddingBlock: 12,
    },
    Statistic: {
      contentFontSize: 28,
    },
    Button: {
      borderRadius: 8,
      controlHeight: 32,
      controlHeightLG: 40,
    },
  },
};
