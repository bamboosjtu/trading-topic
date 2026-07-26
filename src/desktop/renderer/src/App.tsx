import { ConfigProvider, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Routes, Route, Navigate } from "react-router-dom";
import { theme } from "./theme";
import { AppLayout } from "./components/AppLayout";
import { BacktestPage } from "./pages/BacktestPage";
import { SkeletonPage } from "./pages/SkeletonPage";

export function App() {
  return (
    <ConfigProvider theme={theme} locale={zhCN}>
      <AntdApp>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/backtest" replace />} />
            <Route path="/backtest" element={<BacktestPage />} />
            {[
              "/portfolio-backtest",
              "/symbol-compare",
              "/projection",
              "/overview",
              "/positions",
              "/trades",
              "/dividend-calendar",
              "/cashflow",
              "/drawdown-monitor",
              "/data-sources",
              "/fees",
              "/backup",
              "/settings",
            ].map((path) => (
              <Route key={path} path={path} element={<SkeletonPage />} />
            ))}
            <Route path="/account" element={<Navigate to="/overview" replace />} />
            <Route path="/ledger" element={<Navigate to="/cashflow" replace />} />
            <Route path="*" element={<Navigate to="/backtest" replace />} />
          </Route>
        </Routes>
      </AntdApp>
    </ConfigProvider>
  );
}
