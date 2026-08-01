import { useMemo } from "react";
import { Alert, Button, Layout } from "antd";
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

const NAV_GROUPS: NavigationGroup[] = [
  {
    label: "研究",
    items: [
      { key: "/backtest", icon: <FundProjectionScreenOutlined />, label: "定投回测" },
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
  const { data: diagnostics } = useQuery({
    queryKey: ["diagnostics"],
    queryFn: api.getDiagnostics,
    retry: 0,
  });
  const currentMarketYear = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(new Date()),
  );
  const currentCalendarPending = diagnostics
    ? diagnostics.marketCalendars.find(
        (calendar) => calendar.year === currentMarketYear,
      )?.status !== "official"
    : false;
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
            <div className="brand-mark">研</div>
            <div className="brand-copy">
              <div className="brand-name">投资研究实验室</div>
              <div className="brand-en">INVESTMENT LAB</div>
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
                        title={item.label}
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
              本地模式 ·
              <span className="tabular-nums"> v{health?.version ?? "—"}</span>
            </div>
          </div>
        </Header>

        <Content className="app-content">
          {currentCalendarPending ? (
            <Alert
              className="mb-4"
              type="error"
              showIcon
              message={`${currentMarketYear} 年交易日历尚未更新`}
              description="本地历史数据、流水、备份、日志和设置仍可使用；依赖当前年度日历的行情补齐、日期确认和新回测已阻断。"
              action={
                <Button onClick={() => navigate("/settings")}>
                  查看诊断
                </Button>
              }
            />
          ) : null}
          <div key={selectedKey} className="workspace-enter">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
