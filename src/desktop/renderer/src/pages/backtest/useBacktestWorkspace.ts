import { useEffect, useState } from "react";
import { Form } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { FormInstance } from "antd";
import type {
  BacktestCandlePeriod,
  BacktestChartMetric,
  BacktestRequest,
  BacktestWorkspaceState,
} from "../../api/client";
import { api } from "../../api/client";
import type { BacktestRangePreset } from "./dateUtils";

interface UseBacktestWorkspaceOptions {
  form: FormInstance<BacktestRequest>;
  activeExperimentId: string | undefined;
  chartMetric: BacktestChartMetric;
  candlePeriod: BacktestCandlePeriod;
  chartSymbol: string;
  rangePreset: BacktestRangePreset;
  onRestore: (state: BacktestWorkspaceState) => void;
}

export function useBacktestWorkspace({
  form,
  activeExperimentId,
  chartMetric,
  candlePeriod,
  chartSymbol,
  rangePreset,
  onRestore,
}: UseBacktestWorkspaceOptions) {
  const [restored, setRestored] = useState(false);
  const formValues = Form.useWatch([], form) as BacktestRequest | undefined;
  const workspace = useQuery({
    queryKey: ["backtest:workspace"],
    queryFn: api.getBacktestWorkspace,
  });

  useEffect(() => {
    if (!workspace.isFetched || restored) return;
    if (workspace.data) {
      form.setFieldsValue(workspace.data.request);
      onRestore(workspace.data);
    }
    setRestored(true);
  }, [form, onRestore, restored, workspace.data, workspace.isFetched]);

  useEffect(() => {
    if (!restored || !formValues?.symbols?.length) return;
    const timer = window.setTimeout(() => {
      const request = form.getFieldsValue(true);
      void api.saveBacktestWorkspace({
        request: {
          ...request,
          rangeYears:
            rangePreset === "custom" ? undefined : rangePreset,
        },
        chartMetric,
        candlePeriod,
        chartSymbol,
        activeExperimentId,
        updatedAt: new Date().toISOString(),
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    activeExperimentId,
    candlePeriod,
    chartMetric,
    chartSymbol,
    form,
    formValues,
    rangePreset,
    restored,
  ]);

  return {
    restored,
    loading: workspace.isLoading,
    error: workspace.error,
  };
}
