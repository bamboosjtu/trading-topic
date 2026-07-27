import { lazy, Suspense } from "react";
import { ConfigProvider, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Routes, Route, Navigate } from "react-router-dom";
import { theme } from "./theme";
import { AppLayout } from "./components/AppLayout";
import { SkeletonPage } from "./pages/SkeletonPage";

const BacktestPage = lazy(() =>
  import("./pages/BacktestPage").then((module) => ({
    default: module.BacktestPage,
  })),
);
const PositionsPage = lazy(() =>
  import("./pages/PositionsPage").then((module) => ({
    default: module.PositionsPage,
  })),
);
const TradesPage = lazy(() =>
  import("./pages/TradesPage").then((module) => ({
    default: module.TradesPage,
  })),
);
const IncomeCalendarPage = lazy(() =>
  import("./pages/IncomeCalendarPage").then((module) => ({
    default: module.IncomeCalendarPage,
  })),
);

export function App() {
  return (
    <ConfigProvider theme={theme} locale={zhCN}>
      <AntdApp>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/backtest" replace />} />
            <Route
              path="/backtest"
              element={<Suspense fallback={<SkeletonPage />}><BacktestPage /></Suspense>}
            />
            <Route
              path="/positions"
              element={<Suspense fallback={<SkeletonPage />}><PositionsPage /></Suspense>}
            />
            <Route
              path="/trades"
              element={<Suspense fallback={<SkeletonPage />}><TradesPage /></Suspense>}
            />
            <Route
              path="/income-calendar"
              element={<Suspense fallback={<SkeletonPage />}><IncomeCalendarPage /></Suspense>}
            />
            <Route path="/settings" element={<SkeletonPage />} />
            <Route path="*" element={<Navigate to="/backtest" replace />} />
          </Route>
        </Routes>
      </AntdApp>
    </ConfigProvider>
  );
}
