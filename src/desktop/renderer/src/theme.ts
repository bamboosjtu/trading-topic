import type { ThemeConfig } from "antd";

/**
 * 现代 SaaS 视觉风格基线（攒股收息 R1）。
 *
 * 设计取向：
 * - 墨蓝导航与暖金单一强调色，保持财富管理工具的克制；
 * - 雾白工作区与细分隔线，减少卡片堆叠；
 * - 字号层级清晰，数字使用等宽字体强化金融工具感。
 *
 * 与 Tailwind 配色对齐：见 tailwind.config.ts 中的 brand / ink 色板。
 */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: "#b88746",
    colorInfo: "#315f78",
    colorSuccess: "#2d7650",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    colorTextBase: "#14232e",
    colorBgBase: "#ffffff",
    colorBorder: "#dfe5e8",
    colorBorderSecondary: "#edf0f2",
    colorBgLayout: "#f3f5f7",
    colorBgContainer: "#ffffff",

    borderRadius: 7,
    borderRadiusLG: 10,
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
  },
  components: {
    Layout: {
      headerBg: "#f8fafb",
      headerHeight: 56,
      headerPadding: "0 24px",
      bodyBg: "#f3f5f7",
      siderBg: "#0d1b26",
    },
    Menu: {
      darkItemBg: "#0d1b26",
      darkItemSelectedBg: "#1a3040",
      darkItemSelectedColor: "#e9c991",
      darkItemHoverBg: "#142735",
    },
    Card: {
      borderRadiusLG: 10,
      boxShadowTertiary:
        "0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02)",
    },
    Table: {
      headerBg: "#f6f8f9",
      headerColor: "#52636e",
      rowHoverBg: "#f8fafb",
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
