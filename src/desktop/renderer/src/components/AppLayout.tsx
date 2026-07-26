import { useMemo } from "react";
import { Button, Layout, Tooltip } from "antd";
import {
  AimOutlined,
  ApartmentOutlined,
  BankOutlined,
  CalendarOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DollarCircleOutlined,
  DownOutlined,
  FundProjectionScreenOutlined,
  LineChartOutlined,
  PieChartOutlined,
  SettingOutlined,
  StockOutlined,
  SwapOutlined,
  UserOutlined,
  WalletOutlined,
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
      { key: "/portfolio-backtest", icon: <ApartmentOutlined />, label: "组合回测" },
      { key: "/symbol-compare", icon: <AimOutlined />, label: "标的对比" },
      { key: "/projection", icon: <LineChartOutlined />, label: "10年测算" },
    ],
  },
  {
    label: "账户",
    items: [
      { key: "/overview", icon: <WalletOutlined />, label: "资产总览" },
      { key: "/positions", icon: <PieChartOutlined />, label: "持仓明细" },
      { key: "/trades", icon: <SwapOutlined />, label: "交易流水" },
      { key: "/dividend-calendar", icon: <CalendarOutlined />, label: "分红日历" },
      { key: "/cashflow", icon: <StockOutlined />, label: "资金流水" },
      { key: "/repo", icon: <BankOutlined />, label: "国债逆回购" },
    ],
  },
  {
    label: "系统",
    items: [
      { key: "/data-sources", icon: <DatabaseOutlined />, label: "数据源管理" },
      { key: "/fees", icon: <DollarCircleOutlined />, label: "费用与规则" },
      { key: "/backup", icon: <CloudUploadOutlined />, label: "备份与恢复" },
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
      <Sider width={200} theme="light" className="app-sidebar">
        <div className="flex h-full flex-col">
          <div className="app-brand">
            <div className="brand-mark">攒</div>
            <div>
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
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="local-only">
            <span className="local-only-dot" />
            <span>数据仅保存在本机</span>
          </div>
        </div>
      </Sider>

      <Layout className="min-w-0">
        <Header className="app-header">
          <div className="ml-auto flex items-center gap-3">
            <div className="data-cutoff">
              数据截止：
              <span className="tabular-nums">{health?.dataCutoff ?? "暂无快照"}</span>
            </div>
            <Tooltip title="设置">
              <Button
                aria-label="打开设置"
                className="header-icon-button"
                icon={<SettingOutlined />}
                onClick={() => navigate("/settings")}
              />
            </Tooltip>
            <button
              type="button"
              className="research-mode"
              onClick={() => navigate("/settings")}
            >
              <span className="research-avatar">
                <UserOutlined />
              </span>
              <span>本地研究模式</span>
              <DownOutlined className="text-[9px]" />
            </button>
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
