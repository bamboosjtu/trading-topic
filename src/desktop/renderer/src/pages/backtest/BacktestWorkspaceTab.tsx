import type { ReactNode } from "react";

interface BacktestWorkspaceTabProps {
  readonlyBanner?: ReactNode;
  config: ReactNode;
  metrics: ReactNode;
  chart: ReactNode;
  currentExperiment: ReactNode;
}

export function BacktestWorkspaceTab({
  readonlyBanner,
  config,
  metrics,
  chart,
  currentExperiment,
}: BacktestWorkspaceTabProps) {
  return (
    <>
      {readonlyBanner}
      {config}
      {metrics}
      {chart}
      {currentExperiment}
    </>
  );
}
