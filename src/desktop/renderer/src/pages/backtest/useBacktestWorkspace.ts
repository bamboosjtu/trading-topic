import { useEffect, useRef, useState } from "react";
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
  const [usingDefaultWorkspace, setUsingDefaultWorkspace] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveSequence = useRef(0);
  const formValues = Form.useWatch([], form) as BacktestRequest | undefined;
  const workspace = useQuery({
    queryKey: ["backtest:workspace"],
    queryFn: api.getBacktestWorkspace,
  });

  useEffect(() => {
    if (!workspace.isSuccess || restored) return;
    if (workspace.data) {
      form.setFieldsValue(workspace.data.request);
      onRestore(workspace.data);
    }
    setRestored(true);
  }, [form, onRestore, restored, workspace.data, workspace.isSuccess]);

  useEffect(() => {
    if (!restored || !formValues?.symbols?.length) return;
    const timer = window.setTimeout(() => {
      const request = form.getFieldsValue(true);
      const sequence = ++saveSequence.current;
      void api
        .saveBacktestWorkspace({
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
        })
        .then(() => {
          if (sequence === saveSequence.current) setSaveError(null);
        })
        .catch((error: unknown) => {
          const reason =
            error instanceof Error ? error.message : String(error);
          console.error("保存回测工作区失败", error);
          if (sequence === saveSequence.current) {
            setSaveError(`工作区未能保存：${reason}`);
          }
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

  const loadError =
    workspace.isError && !usingDefaultWorkspace
      ? workspace.error instanceof Error
        ? workspace.error.message
        : String(workspace.error)
      : null;

  return {
    restored,
    loading: workspace.isLoading,
    loadError,
    retrying: workspace.isFetching,
    saveError,
    retryLoad: () => {
      setUsingDefaultWorkspace(false);
      setRestored(false);
      void workspace.refetch();
    },
    useDefaultWorkspace: () => {
      setUsingDefaultWorkspace(true);
      setRestored(true);
    },
    clearSaveError: () => setSaveError(null),
  };
}
