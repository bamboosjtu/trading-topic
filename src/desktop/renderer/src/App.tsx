import { ConfigProvider, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Routes, Route, Navigate } from "react-router-dom";
import { theme } from "./theme";
import { AppLayout } from "./components/AppLayout";
import { BacktestPage } from "./pages/BacktestPage";
import { AccountPage } from "./pages/AccountPage";
import { LedgerPage } from "./pages/LedgerPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <ConfigProvider theme={theme} locale={zhCN}>
      <AntdApp>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/backtest" replace />} />
            <Route path="/backtest" element={<BacktestPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/backtest" replace />} />
          </Route>
        </Routes>
      </AntdApp>
    </ConfigProvider>
  );
}
