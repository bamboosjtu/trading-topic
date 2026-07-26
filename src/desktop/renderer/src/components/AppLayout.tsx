import { useMemo } from "react";
import { Layout, Menu } from "antd";
import {
  LineChartOutlined,
  WalletOutlined,
  ProfileOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  CalendarOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api/client";

const { Header, Sider, Content } = Layout;

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
      <Sider
        width={240}
        theme="dark"
        style={{
          background: "linear-gradient(180deg, #0c2233 0%, #081826 78%)",
        }}
      >
        <div className="h-full flex flex-col">
          <div className="px-5 pt-7 pb-5">
            <div className="flex items-center gap-3">
              <div className="brand-mark">攒</div>
              <div>
                <div className="text-[16px] font-semibold tracking-wide text-white leading-5">
                  攒股收息
                </div>
                <div className="mt-0.5 text-[10px] tracking-[0.28em] uppercase text-[#c9a961]">
                  Dividend Desk
                </div>
              </div>
            </div>
            <div className="mt-4 text-[11px] leading-5 text-[#7c93a4]">
              R1 · 本地研究工作台
              <br />
              长期定投与股息再投资验证
            </div>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={NAV_ITEMS}
            onClick={({ key }) => navigate(key)}
            style={{
              background: "transparent",
              border: 0,
              padding: "8px 0 0",
            }}
          />
          <div className="mt-auto px-4 pb-5">
            <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-4 py-3.5">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[#e8ddbe]">
                <SafetyCertificateOutlined className="text-[#d8b56a]" />
                <span>数据仅保存在本机</span>
              </div>
              <div className="mt-1.5 text-[11px] leading-4 text-[#6e8698]">
                不连接券商，不执行交易
              </div>
            </div>
          </div>
        </div>
      </Sider>
      <Layout>
        <Header
          className="flex items-center justify-end gap-4"
          style={{
            background: "#ffffff",
            borderBottom: "1px solid #ebe5d8",
            height: 56,
            lineHeight: "normal",
            padding: "0 28px",
          }}
        >
          <span className={`status-pill ${health ? "ok" : "pending"}`}>
            <span className="dot" />
            {health ? "Node 服务正常" : "服务连接中"}
          </span>
          <span className="h-4 w-px bg-[#e6e0d2]" />
          <span className="flex items-center gap-1.5 text-xs text-[#7b7668]">
            <CalendarOutlined className="text-[#a39e8d]" />
            <span className="tabular-nums">
              {health?.dataCutoff
                ? `行情截止 ${health.dataCutoff}`
                : "尚无本地行情快照"}
            </span>
          </span>
        </Header>
        <Content
          className="overflow-auto"
          style={{ background: "#f5f2eb", padding: "28px 32px 44px" }}
        >
          <div className="workspace-enter">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
