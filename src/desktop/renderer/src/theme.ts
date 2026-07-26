import type { ThemeConfig } from "antd";

/**
 * 私人研究工作台视觉基线（攒股收息 R1）。
 *
 * 设计取向：
 * - 深墨蓝承担权威色（侧边栏、主按钮、链接），香槟金只做克制点缀；
 * - 暖瓷白工作区 + 白面板 + 暖调细分隔线，参考私人银行的稳重感；
 * - 数字使用等宽字体强化金融工具感，层级靠字重与留白而非投影堆叠。
 *
 * 与 Tailwind 配色对齐：见 tailwind.config.ts 中的 navy / gold / ink / line 色板。
 */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: "#174b6b",
    colorInfo: "#226186",
    colorLink: "#226186",
    colorSuccess: "#2e7d4f",
    colorWarning: "#d98a06",
    colorError: "#d4382c",

    colorTextBase: "#1e1c18",
    colorBgBase: "#ffffff",
    colorBgLayout: "#f5f2eb",
    colorBgContainer: "#ffffff",
    colorBorder: "#e0d9c8",
    colorBorderSecondary: "#f0ebdf",

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

    controlHeight: 34,
    controlHeightLG: 42,
    controlHeightSM: 26,

    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontFamilyCode:
      "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",

    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: "#ffffff",
      headerHeight: 56,
      headerPadding: "0 28px",
      bodyBg: "#f5f2eb",
      siderBg: "#0a1f2e",
    },
    Menu: {
      darkItemBg: "transparent",
      darkItemColor: "rgba(226, 232, 238, 0.66)",
      darkItemHoverBg: "rgba(255, 255, 255, 0.06)",
      darkItemHoverColor: "#ffffff",
      darkItemSelectedBg: "rgba(212, 168, 87, 0.18)",
      darkItemSelectedColor: "#ecc97f",
      itemHeight: 40,
      itemMarginInline: 12,
      itemBorderRadius: 8,
    },
    Card: {
      borderRadiusLG: 12,
      boxShadowTertiary:
        "0 1px 2px 0 rgba(69, 58, 33, 0.04), 0 8px 24px -16px rgba(69, 58, 33, 0.12)",
    },
    Table: {
      headerBg: "#faf7f0",
      headerColor: "#6f6a5d",
      headerSplitColor: "rgba(0, 0, 0, 0)",
      rowHoverBg: "#faf6ee",
      borderColor: "#f0ebdf",
      cellPaddingBlock: 13,
    },
    Form: {
      labelColor: "#4a463d",
      labelFontSize: 13,
    },
    Button: {
      borderRadius: 8,
      controlHeight: 34,
      controlHeightLG: 42,
      fontWeight: 500,
      primaryShadow: "0 2px 6px -2px rgba(18, 58, 84, 0.45)",
      defaultBorderColor: "#dcd5c3",
    },
    Statistic: {
      contentFontSize: 28,
    },
    Drawer: {
      paddingLG: 24,
    },
  },
};
