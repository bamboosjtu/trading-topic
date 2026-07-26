import type { ReactNode } from "react";

interface BacktestWorkspaceTabProps {
  statusNotice?: ReactNode;
  readonlyBanner?: ReactNode;
  config: ReactNode;
  metrics: ReactNode;
  chart: ReactNode;
  currentExperiment: ReactNode;
}

export function BacktestWorkspaceTab({
  statusNotice,
  readonlyBanner,
  config,
  metrics,
  chart,
  currentExperiment,
}: BacktestWorkspaceTabProps) {
  return (
    <>
      {statusNotice}
      {readonlyBanner}
      {config}
      {metrics}
      {chart}
      {currentExperiment}
    </>
  );
}
