import { useMemo } from "react";
import { Layout, Menu, Typography, Tag, Space } from "antd";
import {
  LineChartOutlined,
  WalletOutlined,
  ProfileOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api/client";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const NAV_ITEMS = [
  { key: "/backtest", icon: <LineChartOutlined />, label: "历史回测" },
  { key: "/account", icon: <WalletOutlined />, label: "资产账户" },
  { key: "/ledger", icon: <ProfileOutlined />, label: "资金流水" },
  { key: "/settings", icon: <SettingOutlined />, label: "本地设置" },
];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    retry: 0,
  });
  const selectedKey = useMemo(
    () =>
      NAV_ITEMS.find((item) => location.pathname.startsWith(item.key))?.key ??
      "/backtest",
    [location.pathname],
  );

  return (
    <Layout className="h-screen">
      <Sider width={232} theme="dark" style={{ background: "#0d1b26" }}>
        <div className="h-full flex flex-col">
          <div className="px-6 pt-7 pb-6">
            <div className="text-[11px] tracking-[0.24em] uppercase text-[#8ea0ac]">
              Income Desk
            </div>
            <div className="mt-2 text-[21px] font-semibold tracking-tight text-white">
              攒股收息
            </div>
            <div className="mt-1 text-xs text-[#8ea0ac]">R1 · 本地研究工作台</div>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={NAV_ITEMS}
            onClick={({ key }) => navigate(key)}
            style={{ background: "transparent", border: 0, padding: "0 10px" }}
          />
          <div className="mt-auto px-5 pb-6 text-xs text-[#8ea0ac] leading-5">
            <div className="flex items-center gap-2 text-[#d8b77d] mb-2">
              <SafetyCertificateOutlined />
              <span>数据仅保存在本机</span>
            </div>
            不连接券商，不执行交易
          </div>
        </div>
      </Sider>
      <Layout>
        <Header
          className="flex items-center justify-end"
          style={{
            background: "#f8fafb",
            borderBottom: "1px solid #dfe5e8",
            height: 54,
            lineHeight: "54px",
            padding: "0 28px",
          }}
        >
          <Space size={14}>
            <Tag bordered={false} color={health ? "success" : "default"}>
              {health ? "Node 服务正常" : "服务连接中"}
            </Tag>
            <Text type="secondary" className="text-xs">
              {health?.dataCutoff
                ? `行情截止 ${health.dataCutoff}`
                : "尚无本地行情快照"}
            </Text>
          </Space>
        </Header>
        <Content
          className="overflow-auto"
          style={{ background: "#f3f5f7", padding: "26px 30px 36px" }}
        >
          <div className="workspace-enter">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
