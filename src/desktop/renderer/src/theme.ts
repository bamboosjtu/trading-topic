import type { ThemeConfig } from "antd";

/**
 * 新版投研工作台基线：冷白画布、深海军蓝文字、亮蓝单一动作色。
 * 页面密度与组件尺寸以 1920 × 1080 的设计稿为基准。
 */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: "#1677ff",
    colorInfo: "#1677ff",
    colorLink: "#0d5dc3",
    colorSuccess: "#13a68f",
    colorWarning: "#f5a623",
    colorError: "#f04438",
    colorTextBase: "#112543",
    colorTextSecondary: "#60738f",
    colorBgBase: "#ffffff",
    colorBgLayout: "#f6f8fb",
    colorBgContainer: "#ffffff",
    colorBorder: "#dfe6ef",
    colorBorderSecondary: "#edf1f6",
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 5,
    fontSize: 13,
    fontSizeLG: 14,
    fontSizeSM: 12,
    fontSizeXL: 20,
    controlHeight: 32,
    controlHeightLG: 36,
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
      bodyBg: "#f6f8fb",
      siderBg: "#ffffff",
    },
    Button: {
      borderRadius: 6,
      controlHeight: 32,
      controlHeightLG: 36,
      fontWeight: 500,
      primaryShadow: "0 4px 12px -5px rgba(22, 119, 255, 0.6)",
      defaultBorderColor: "#dfe6ef",
    },
    Table: {
      headerBg: "#f8fafc",
      headerColor: "#223957",
      headerSplitColor: "transparent",
      rowHoverBg: "#f6f9ff",
      borderColor: "#edf1f6",
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
    },
    Form: {
      labelColor: "#172c4c",
      labelFontSize: 12,
      verticalLabelPadding: "0 0 5px",
    },
    Input: {
      activeBorderColor: "#7eb2ff",
      hoverBorderColor: "#a9c9fb",
    },
    InputNumber: {
      activeBorderColor: "#7eb2ff",
      hoverBorderColor: "#a9c9fb",
    },
    Select: {
      activeBorderColor: "#7eb2ff",
      hoverBorderColor: "#a9c9fb",
      optionSelectedBg: "#edf5ff",
    },
    Modal: {
      borderRadiusLG: 10,
      paddingContentHorizontalLG: 22,
      titleFontSize: 17,
    },
    Pagination: {
      itemActiveBg: "#ffffff",
      itemBg: "transparent",
    },
    Skeleton: {
      gradientFromColor: "#edf1f6",
      gradientToColor: "#f8fafc",
    },
  },
};
