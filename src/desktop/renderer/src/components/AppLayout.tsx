import { useMemo } from "react";
import { Layout, Menu, Typography, Tag } from "antd";
import {
  LineChartOutlined,
  WalletOutlined,
  ProfileOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useLocation, Outlet, useNavigate } from "react-router-dom";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const NAV_ITEMS = [
  { key: "/backtest", icon: <LineChartOutlined />, label: "回测" },
  { key: "/account", icon: <WalletOutlined />, label: "账户" },
  { key: "/ledger", icon: <ProfileOutlined />, label: "流水" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
] as const;

const PAGE_TITLE_MAP: Record<string, string> = {
  "/backtest": "回测",
  "/account": "账户",
  "/ledger": "流水",
  "/settings": "设置",
};

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const selectedKey = useMemo(() => {
    const match = NAV_ITEMS.find((item) =>
      location.pathname.startsWith(item.key)
    );
    return match?.key ?? "/backtest";
  }, [location.pathname]);

  const pageTitle = PAGE_TITLE_MAP[selectedKey] ?? "";

  return (
    <Layout className="h-screen">
      <Sider
        width={240}
        theme="light"
        className="border-r border-ink-200 flex flex-col"
        style={{ borderRight: "1px solid #e5e5e5" }}
      >
        {/* 品牌 */}
        <div
          className="flex items-center gap-2 px-6 h-14 border-b border-ink-100"
          style={{ borderBottom: "1px solid #f5f5f5" }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-semibold"
            style={{ backgroundColor: "#15803d" }}
          >
            攒
          </div>
          <div className="flex flex-col leading-tight">
            <Text strong className="text-base">
              攒股收息
            </Text>
            <Text type="secondary" className="text-xs">
              R1 · 本地优先
            </Text>
          </div>
        </div>

        {/* 导航 */}
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
          className="flex-1 border-r-0"
          style={{ borderRight: 0, paddingTop: 8 }}
        />

        {/* 风险提示（PRD §3.3 强制要求） */}
        <div
          className="px-4 py-3 border-t border-ink-100"
          style={{ borderTop: "1px solid #f5f5f5" }}
        >
          <Tag
            color="warning"
            className="text-xs leading-relaxed"
            style={{ margin: 0, padding: "4px 8px", whiteSpace: "normal" }}
          >
            仅供研究与记录，不构成投资建议
          </Tag>
        </div>
      </Sider>

      <Layout>
        <Header
          className="bg-white border-b border-ink-200 flex items-center justify-between px-6"
          style={{
            backgroundColor: "#ffffff",
            borderBottom: "1px solid #e5e5e5",
            height: 56,
            lineHeight: "56px",
            padding: "0 24px",
          }}
        >
          <Text strong className="text-lg">
            {pageTitle}
          </Text>
          <div className="flex items-center gap-3">
            <Tag color="default" className="text-xs">
              数据截止：尚未连接
            </Tag>
          </div>
        </Header>

        <Content
          className="overflow-auto"
          style={{ backgroundColor: "#fafafa", padding: 24 }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
