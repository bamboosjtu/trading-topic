import { useMemo } from "react";
import { Layout } from "antd";
import {
  CalendarOutlined,
  FundProjectionScreenOutlined,
  PieChartOutlined,
  SettingOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api/client";

const { Header, Sider, Content } = Layout;

interface NavigationItem {
  key: string;
  icon: React.ReactNode;
  label: string;
}

interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

export const NAV_GROUPS: NavigationGroup[] = [
  {
    label: "研究",
    items: [
      { key: "/backtest", icon: <FundProjectionScreenOutlined />, label: "历史回测" },
    ],
  },
  {
    label: "实盘",
    items: [
      { key: "/positions", icon: <PieChartOutlined />, label: "持仓明细" },
      { key: "/trades", icon: <SwapOutlined />, label: "交易流水" },
      { key: "/income-calendar", icon: <CalendarOutlined />, label: "收益日历" },
    ],
  },
  {
    label: "系统",
    items: [
      { key: "/settings", icon: <SettingOutlined />, label: "设置" },
    ],
  },
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
      NAV_GROUPS.flatMap((group) => group.items).find((item) =>
        location.pathname.startsWith(item.key),
      )?.key ?? "/backtest",
    [location.pathname],
  );

  return (
    <Layout className="app-shell">
      <Sider
        width={256}
        trigger={null}
        theme="light"
        className="app-sidebar"
      >
        <div className="flex h-full flex-col">
          <div className="app-brand">
            <div className="brand-mark">攒</div>
            <div className="brand-copy">
              <div className="brand-name">攒股收息</div>
              <div className="brand-en">DIVIDEND DESK</div>
            </div>
          </div>

          <nav className="app-navigation" aria-label="主导航">
            {NAV_GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <div className="nav-group-label">{group.label}</div>
                <div className="nav-group-items">
                  {group.items.map((item) => {
                    const active = selectedKey === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        className={`nav-item${active ? " active" : ""}`}
                        onClick={() => navigate(item.key)}
                      >
                        <span className="nav-item-icon">{item.icon}</span>
                        <span className="nav-item-label">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="local-only">
            <span className="local-only-dot" />
            <span className="local-only-label">数据仅保存在本机</span>
          </div>
        </div>
      </Sider>

      <Layout className="min-w-0">
        <Header className="app-header">
          <div className="ml-auto flex items-center">
            <div className="data-cutoff">
              数据截止：
              <span className="tabular-nums">{health?.dataCutoff ?? "暂无快照"}</span>
            </div>
          </div>
        </Header>

        <Content className="app-content">
          <div key={selectedKey} className="workspace-enter">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
