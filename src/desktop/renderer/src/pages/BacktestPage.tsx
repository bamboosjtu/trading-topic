import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Form, Space } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type BacktestCandlePeriod,
  type BacktestChartMetric,
  type BacktestExperiment,
  type BacktestExperimentSummary,
  type BacktestRequest,
  type BacktestResult,
  type BacktestWorkspaceState,
} from "../api/client";
import { BacktestChartPanel } from "./backtest/BacktestChartPanel";
import { BacktestConfig } from "./backtest/BacktestConfig";
import { BacktestDetailModal } from "./backtest/BacktestDetailModal";
import { BacktestMetrics } from "./backtest/BacktestMetrics";
import { BacktestWorkspaceTab } from "./backtest/BacktestWorkspaceTab";
import { CurrentExperimentTable } from "./backtest/CurrentExperimentTable";
import { ExperimentHistoryTable } from "./backtest/ExperimentHistoryTable";
import type { BacktestRangePreset } from "./backtest/dateUtils";
import { useActiveExperiment } from "./backtest/useActiveExperiment";
import { useBacktestWorkspace } from "./backtest/useBacktestWorkspace";
import { useMarketBars } from "./backtest/useMarketBars";
import { securityTypeForInstrument } from "../../../shared/instruments";
import { beijingTimestamp } from "./_shared/format";

export function BacktestPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<BacktestRequest>();
  const [pageTab, setPageTab] = useState<"run" | "history">("run");
  const [currentExperiment, setCurrentExperiment] =
    useState<BacktestExperiment | null>(null);
  const [activeExperimentId, setActiveExperimentId] = useState<string>();
  const [activeExperimentError, setActiveExperimentError] = useState<
    string | null
  >(null);
  const [viewingReadonly, setViewingReadonly] = useState(false);
  const [detail, setDetail] = useState<BacktestResult | null>(null);
  const [rangePreset, setRangePreset] =
    useState<BacktestRangePreset>(3);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [chartMetric, setChartMetric] =
    useState<BacktestChartMetric>("kline");
  const [candlePeriod, setCandlePeriod] =
    useState<BacktestCandlePeriod>("day");
  const [chartSymbol, setChartSymbol] = useState("601398");
  const [symbolPickerOpen, setSymbolPickerOpen] = useState(false);

  const stocks = useQuery({
    queryKey: ["stocks"],
    queryFn: api.listAStocks,
    staleTime: 60 * 60 * 1_000,
  });
  const experiments = useQuery({
    queryKey: ["backtest:experiments"],
    queryFn: api.listBacktestExperiments,
  });
  const active = useActiveExperiment(
    activeExperimentId,
    currentExperiment,
  );
  const results = active.results;

  const restoreWorkspace = useCallback(
    (state: BacktestWorkspaceState) => {
      setRangePreset(state.request.rangeYears ?? "custom");
      setChartMetric(state.chartMetric);
      setCandlePeriod(state.candlePeriod);
      setChartSymbol(state.chartSymbol);
      setActiveExperimentId(state.activeExperimentId);
    },
    [],
  );
  const workspacePersistence = useBacktestWorkspace({
    form,
    activeExperimentId,
    chartMetric,
    candlePeriod,
    chartSymbol,
    rangePreset,
    onRestore: restoreWorkspace,
  });

  const stockOptions = useMemo(
    () =>
      (stocks.data ?? [])
        .filter((stock) => securityTypeForInstrument(stock) === "stock")
        .map(({ symbol, name }) => ({
          value: symbol,
          label: name,
          searchText: `${name} ${symbol}`.toLocaleLowerCase("zh-CN"),
        })),
    [stocks.data],
  );

  const runBacktest = useMutation({
    mutationFn: api.runBacktest,
    onSuccess: (experiment) => {
      setCurrentExperiment(experiment);
      setActiveExperimentId(experiment.experimentId);
      setActiveExperimentError(null);
      setViewingReadonly(false);
      const nextChartSymbol = experiment.results.some(
        (result) => result.symbol === chartSymbol,
      )
        ? chartSymbol
        : (experiment.results[0]?.symbol ?? chartSymbol);
      setChartSymbol(nextChartSymbol);
      void queryClient.invalidateQueries({
        queryKey: ["backtest:experiments"],
      });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      message.success(`已完成 ${experiment.results.length} 个标的回测`);
    },
    onError: (error) => message.error(error.message),
  });
  const exportExperiment = useMutation({
    mutationFn: api.exportBacktestExperiment,
    onSuccess: (result) => {
      if (!result.cancelled) message.success("已导出本次实验及逐标的明细");
    },
    onError: (error) => message.error(error.message),
  });
  const openExperiment = useMutation({
    mutationFn: api.getBacktestExperiment,
    onSuccess: (experiment) => {
      form.setFieldsValue(experiment.request);
      setRangePreset(experiment.request.rangeYears ?? "custom");
      setCurrentExperiment(experiment);
      setActiveExperimentId(experiment.experimentId);
      setActiveExperimentError(null);
      setChartSymbol(experiment.results[0]?.symbol ?? chartSymbol);
      setViewingReadonly(true);
      setPageTab("run");
    },
    onError: (error) => message.error(error.message),
  });
  const deleteExperiment = useMutation({
    mutationFn: api.deleteBacktestExperiment,
    onSuccess: (_, experimentId) => {
      if (activeExperimentId === experimentId) {
        setActiveExperimentId(undefined);
        setCurrentExperiment(null);
        setViewingReadonly(false);
      }
      void queryClient.invalidateQueries({
        queryKey: ["backtest:experiments"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["backtest:workspace"],
      });
      message.success("回测试验已删除");
    },
    onError: (error) => message.error(error.message),
  });

  useEffect(() => {
    if (!active.error || !activeExperimentId) return;
    const failedExperimentId = activeExperimentId;
    const reason =
      active.error instanceof Error
        ? active.error.message
        : String(active.error);
    setActiveExperimentError(
      `当前实验不存在或无法读取。已清除失效的工作区引用：${reason}`,
    );
    setActiveExperimentId(undefined);
    setCurrentExperiment(null);
    setViewingReadonly(false);
    setDetail(null);
    queryClient.removeQueries({
      queryKey: ["backtest:experiment", failedExperimentId],
      exact: true,
    });
  }, [active.error, activeExperimentId, queryClient]);

  useEffect(() => {
    if (
      results.length &&
      !results.some((result) => result.symbol === chartSymbol)
    ) {
      setChartSymbol(results[0].symbol);
    }
  }, [chartSymbol, results]);

  const focusedResult =
    results.find((result) => result.symbol === chartSymbol) ?? results[0];
  const marketBars = useMarketBars(
    focusedResult,
    active.loading || runBacktest.isPending,
  );

  const beginDraft = useCallback(() => {
    if (!activeExperimentId && !viewingReadonly) return;
    setActiveExperimentId(undefined);
    setCurrentExperiment(null);
    setViewingReadonly(false);
  }, [activeExperimentId, viewingReadonly]);

  const copyBacktestRequest = useCallback(
    (request: BacktestRequest) => {
      form.setFieldsValue(request);
      setRangePreset(request.rangeYears ?? "custom");
      setChartSymbol(request.symbols[0] ?? chartSymbol);
      setActiveExperimentId(undefined);
      setCurrentExperiment(null);
      setActiveExperimentError(null);
      setViewingReadonly(false);
      setPageTab("run");
      message.success("已复制实验参数；修改后可开始新的回测");
    },
    [chartSymbol, form, message],
  );

  const copyExperimentRequest = (
    experiment: BacktestExperimentSummary,
  ) => copyBacktestRequest(experiment.request);

  const readonlyBanner =
    viewingReadonly && active.activeExperiment ? (
      <div className="experiment-readonly-banner">
        <div>
          <strong>正在查看历史实验</strong>
          <span>
            {beijingTimestamp(active.activeExperiment.createdAt)} · 数据截止{" "}
            {active.activeExperiment.dataCutoff} · 参数与结果只读
          </span>
        </div>
        <Button
          size="small"
          onClick={() =>
            copyBacktestRequest(active.activeExperiment!.request)
          }
        >
          复制参数重新回测
        </Button>
      </div>
    ) : undefined;

  return (
    <div className="backtest-page">
      <header className="page-heading backtest-heading">
        <h1>历史回测</h1>
        <div className="backtest-heading-meta">
          <p>固定金额、定投买入、分红再投资，长期走势与收益风险分析</p>
          <button
            type="button"
            className="inline-link"
            onClick={() => setRulesExpanded((value) => !value)}
          >
            回测规则说明
            <InfoCircleOutlined />
          </button>
        </div>
      </header>

      <nav className="backtest-page-tabs" aria-label="历史回测页面">
        <button
          type="button"
          className={pageTab === "run" ? "active" : ""}
          aria-current={pageTab === "run" ? "page" : undefined}
          onClick={() => setPageTab("run")}
        >
          运行回测
        </button>
        <button
          type="button"
          className={pageTab === "history" ? "active" : ""}
          aria-current={pageTab === "history" ? "page" : undefined}
          onClick={() => setPageTab("history")}
        >
          历史结果
          {experiments.data?.length ? (
            <span>{experiments.data.length}</span>
          ) : null}
        </button>
      </nav>

      {pageTab === "history" ? (
        <ExperimentHistoryTable
          experiments={experiments.data ?? []}
          loading={experiments.isLoading}
          deletingId={
            deleteExperiment.isPending
              ? deleteExperiment.variables
              : undefined
          }
          onView={(experiment) =>
            openExperiment.mutate(experiment.experimentId)
          }
          onCopy={copyExperimentRequest}
          onDelete={(experiment) =>
            deleteExperiment.mutate(experiment.experimentId)
          }
        />
      ) : (
        <BacktestWorkspaceTab
          statusNotice={
            activeExperimentError ? (
              <Alert
                showIcon
                closable
                type="error"
                message="无法恢复当前实验"
                description={activeExperimentError}
                onClose={() => setActiveExperimentError(null)}
              />
            ) : workspacePersistence.loadError ? (
              <Alert
                showIcon
                type="error"
                message="工作区加载失败"
                description={`无法读取上次保存的工作区，已暂停自动保存，避免默认参数覆盖原数据：${workspacePersistence.loadError}`}
                action={
                  <Space size={8}>
                    <Button
                      size="small"
                      loading={workspacePersistence.retrying}
                      onClick={workspacePersistence.retryLoad}
                    >
                      重试
                    </Button>
                    <Button
                      size="small"
                      onClick={workspacePersistence.useDefaultWorkspace}
                    >
                      使用默认工作区
                    </Button>
                  </Space>
                }
              />
            ) : workspacePersistence.saveError ? (
              <Alert
                showIcon
                closable
                type="error"
                message="工作区保存失败"
                description={workspacePersistence.saveError}
                onClose={workspacePersistence.clearSaveError}
              />
            ) : undefined
          }
          readonlyBanner={readonlyBanner}
          config={
            <BacktestConfig
              form={form}
              disabled={viewingReadonly}
              rangePreset={rangePreset}
              rulesExpanded={rulesExpanded}
              stockOptions={stockOptions}
              stocksLoading={stocks.isLoading}
              stocksError={stocks.isError}
              symbolPickerOpen={symbolPickerOpen}
              submitting={runBacktest.isPending}
              onPickerOpenChange={setSymbolPickerOpen}
              onBeginDraft={beginDraft}
              onRangePresetChange={setRangePreset}
              onRetryStocks={() => void stocks.refetch()}
              onSubmit={(request) => runBacktest.mutate(request)}
            />
          }
          metrics={<BacktestMetrics results={results} />}
          chart={
            <BacktestChartPanel
              results={results}
              chartMetric={chartMetric}
              candlePeriod={candlePeriod}
              chartSymbol={chartSymbol}
              marketBars={marketBars}
              exporting={exportExperiment.isPending}
              canExport={Boolean(active.activeExperiment)}
              onMetricChange={setChartMetric}
              onPeriodChange={setCandlePeriod}
              onSymbolChange={setChartSymbol}
              onExport={() => {
                if (active.activeExperiment) {
                  exportExperiment.mutate(
                    active.activeExperiment.experimentId,
                  );
                }
              }}
            />
          }
          currentExperiment={
            <CurrentExperimentTable
              experiment={active.activeExperiment}
              results={results}
              loading={active.loading}
              onDetail={setDetail}
            />
          }
        />
      )}

      <BacktestDetailModal result={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
