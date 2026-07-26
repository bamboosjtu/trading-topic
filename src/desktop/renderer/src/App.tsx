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
              "/positions",
              "/trades",
              "/dividend-calendar",
              "/settings",
            ].map((path) => (
              <Route key={path} path={path} element={<SkeletonPage />} />
            ))}
            <Route path="*" element={<Navigate to="/backtest" replace />} />
          </Route>
        </Routes>
      </AntdApp>
    </ConfigProvider>
  );
}
