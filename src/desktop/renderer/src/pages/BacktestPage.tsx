import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popover,
  Select,
  Skeleton,
  Table,
  Tag,
  Tooltip,
} from "antd";
import {
  ClockCircleOutlined,
  DollarOutlined,
  DownloadOutlined,
  GiftOutlined,
  InfoCircleOutlined,
  FallOutlined,
  PlusOutlined,
  RiseOutlined,
  SettingOutlined,
  TrophyFilled,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  BACKTEST_CALIBER_VERSION,
  BACKTEST_DETAIL_PAGE_SIZE,
  BACKTEST_MAX_SYMBOLS,
  BACKTEST_RANGE_YEARS,
  DEFAULT_BACKTEST_SYMBOLS,
} from "../../../shared/constants";
import {
  api,
  type BacktestExperiment,
  type BacktestExperimentSummary,
  type BacktestCandlePeriod,
  type BacktestChartMetric,
  type BacktestRequest,
  type BacktestResult,
  type BacktestWorkspaceState,
  type PricePoint,
  type SimpleBacktestResult,
  type SimpleBacktestRow,
} from "../api/client";
import { BacktestHistoryPanel } from "./BacktestHistoryPanel";

const EVENT_LABELS: Record<SimpleBacktestRow["event"], string> = {
  buy: "定投买入",
  dividend: "分红到账",
  dividend_reinvest: "分红回购",
  share_adjustment: "送转入账",
};

const EVENT_COLORS: Record<SimpleBacktestRow["event"], string> = {
  buy: "blue",
  dividend: "green",
  dividend_reinvest: "cyan",
  share_adjustment: "orange",
};

const CHART_COLORS = [
  "#1677ff",
  "#ff9f1a",
  "#12a594",
  "#7c6cf2",
  "#ef5da8",
  "#875bf7",
  "#0ba5ec",
  "#f79009",
  "#6172f3",
  "#039855",
];

interface CandlePoint {
  date: string;
  open: number;
  close: number;
  low: number;
  high: number;
}

interface DrawdownPeriod {
  months: number;
  start: string;
  end: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateYearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

function longestDrawdownPeriod(result: BacktestResult): DrawdownPeriod {
  let peak = Number.NEGATIVE_INFINITY;
  let peakDate = result.actualStartDate;
  let drawdownStart = "";
  let longestDays = 0;
  let longestStart = "";
  let longestEnd = "";

  for (const point of result.equityCurve) {
    const value = point.nav ?? point.asset;
    if (value >= peak) {
      if (drawdownStart) {
        const duration =
          (Date.parse(point.date) - Date.parse(drawdownStart)) / 86_400_000;
        if (duration > longestDays) {
          longestDays = duration;
          longestStart = drawdownStart;
          longestEnd = point.date;
        }
      }
      peak = value;
      peakDate = point.date;
      drawdownStart = "";
    } else if (!drawdownStart) {
      drawdownStart = peakDate;
    }
  }

  if (drawdownStart && result.actualEndDate) {
    const duration =
      (Date.parse(result.actualEndDate) - Date.parse(drawdownStart)) / 86_400_000;
    if (duration > longestDays) {
      longestDays = duration;
      longestStart = drawdownStart;
      longestEnd = result.actualEndDate;
    }
  }
  return {
    months: Math.max(0, Math.round(longestDays / 30.4375)),
    start: longestStart,
    end: longestEnd,
  };
}

function longestDrawdownMonths(result: BacktestResult): number {
  return longestDrawdownPeriod(result).months;
}

function resultPrices(result: BacktestResult): PricePoint[] {
  if (result.priceSeries?.length) return result.priceSeries;
  const prices = new Map<string, number>();
  for (const row of result.transactions) {
    if (row.price > 0) prices.set(row.date, row.price);
  }
  return [...prices]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function periodKey(date: string, period: BacktestCandlePeriod): string {
  if (period === "month") return date.slice(0, 7);
  if (period === "day") return date;
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

function toCandles(
  prices: PricePoint[],
  period: BacktestCandlePeriod,
): CandlePoint[] {
  const groups = new Map<string, PricePoint[]>();
  for (const point of prices) {
    const key = periodKey(point.date, period);
    const group = groups.get(key) ?? [];
    group.push(point);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const closes = ordered.map((point) => point.close);
    return {
      date: ordered.at(-1)!.date,
      open: ordered[0].close,
      close: ordered.at(-1)!.close,
      low: Math.min(...closes),
      high: Math.max(...closes),
    };
  });
}

function movingAverage(values: number[], window: number): Array<number | "-"> {
  return values.map((_, index) => {
    if (index < window - 1) return "-";
    const slice = values.slice(index - window + 1, index + 1);
    return Number((slice.reduce((sum, value) => sum + value, 0) / window).toFixed(3));
  });
}

export function BacktestPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<BacktestRequest>();
  const [pageTab, setPageTab] = useState<"run" | "history">("run");
  const [currentExperiment, setCurrentExperiment] =
    useState<BacktestExperiment | null>(null);
  const [activeExperimentId, setActiveExperimentId] = useState<string>();
  const [viewingReadonly, setViewingReadonly] = useState(false);
  const [detail, setDetail] = useState<BacktestResult | null>(null);
  const [rangePreset, setRangePreset] = useState<3 | 5 | 10 | 15 | "custom">(3);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [chartMetric, setChartMetric] =
    useState<BacktestChartMetric>("kline");
  const [candlePeriod, setCandlePeriod] =
    useState<BacktestCandlePeriod>("day");
  const [chartSymbol, setChartSymbol] = useState("601398");
  const [workspaceRestored, setWorkspaceRestored] = useState(false);
  const [symbolPickerOpen, setSymbolPickerOpen] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailEventFilters, setDetailEventFilters] = useState<
    SimpleBacktestRow["event"][]
  >([]);
  const buyDay = Form.useWatch("buyDay", form) ?? 1;
  const startDate = Form.useWatch("startDate", form) ?? dateYearsAgo(3);
  const endDate = Form.useWatch("endDate", form) ?? today();
  const monthlyAmount = Form.useWatch("monthlyAmount", form) ?? 3000;
  const selectedSymbols = Form.useWatch("symbols", form) ?? [];

  const stocks = useQuery({
    queryKey: ["stocks"],
    queryFn: api.listStocks,
    staleTime: 60 * 60 * 1_000,
  });
  const experiments = useQuery({
    queryKey: ["backtest:experiments"],
    queryFn: api.listBacktestExperiments,
  });
  const workspace = useQuery({
    queryKey: ["backtest:workspace"],
    queryFn: api.getBacktestWorkspace,
  });
  const persistedExperiment = useQuery({
    queryKey: ["backtest:experiment", activeExperimentId],
    queryFn: () => api.getBacktestExperiment(activeExperimentId!),
    enabled:
      Boolean(activeExperimentId) &&
      currentExperiment?.experimentId !== activeExperimentId,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const activeExperiment =
    currentExperiment?.experimentId === activeExperimentId
      ? currentExperiment
      : persistedExperiment.data;
  const results = activeExperiment?.results ?? [];

  const stockOptions = useMemo(
    () =>
      (stocks.data ?? []).map(({ symbol, name }) => ({
        value: symbol,
        label: name,
        searchText: `${name} ${symbol}`.toLocaleLowerCase("zh-CN"),
      })),
    [stocks.data],
  );

  const mutation = useMutation({
    mutationFn: api.runBacktest,
    onSuccess: (experiment) => {
      setCurrentExperiment(experiment);
      setActiveExperimentId(experiment.experimentId);
      setViewingReadonly(false);
      const nextChartSymbol = experiment.results.some(
        (result) => result.symbol === chartSymbol,
      )
        ? chartSymbol
        : (experiment.results[0]?.symbol ?? chartSymbol);
      setChartSymbol(nextChartSymbol);
      const state: BacktestWorkspaceState = {
        request: experiment.request,
        chartMetric,
        candlePeriod,
        chartSymbol: nextChartSymbol,
        activeExperimentId: experiment.experimentId,
        updatedAt: new Date().toISOString(),
      };
      void api.saveBacktestWorkspace(state);
      void queryClient.invalidateQueries({
        queryKey: ["backtest:experiments"],
      });
      void queryClient.invalidateQueries({ queryKey: ["backtest:workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      message.success(`已完成 ${experiment.results.length} 个标的回测`);
    },
    onError: (error) => message.error(error.message),
  });
  const exportMutation = useMutation({
    mutationFn: (experimentId: string) =>
      api.exportBacktestExperiment(experimentId),
    onSuccess: (result) => {
      if (!result.cancelled) message.success("已导出本次实验及逐标的明细");
    },
    onError: (error) => message.error(error.message),
  });
  const openExperimentMutation = useMutation({
    mutationFn: (experimentId: string) =>
      api.getBacktestExperiment(experimentId),
    onSuccess: (experiment) => {
      form.setFieldsValue(experiment.request);
      setRangePreset(experiment.request.rangeYears ?? "custom");
      setCurrentExperiment(experiment);
      setActiveExperimentId(experiment.experimentId);
      setChartSymbol(experiment.results[0]?.symbol ?? chartSymbol);
      setViewingReadonly(true);
      setPageTab("run");
    },
    onError: (error) => message.error(error.message),
  });
  const deleteExperimentMutation = useMutation({
    mutationFn: (experimentId: string) =>
      api.deleteBacktestExperiment(experimentId),
    onSuccess: (_, experimentId) => {
      if (activeExperimentId === experimentId) {
        setActiveExperimentId(undefined);
        setCurrentExperiment(null);
        setViewingReadonly(false);
      }
      void queryClient.invalidateQueries({
        queryKey: ["backtest:experiments"],
      });
      void queryClient.invalidateQueries({ queryKey: ["backtest:workspace"] });
      message.success("回测试验已删除");
    },
    onError: (error) => message.error(error.message),
  });

  const simpleQuery = useQuery({
    queryKey: ["backtest:detail", detail?.id],
    queryFn: () => api.getBacktestDetail(detail!.id),
    enabled: Boolean(detail),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const simpleResult: SimpleBacktestResult | undefined = simpleQuery.data;
  const filteredDetailRows = useMemo(() => {
    const rows = simpleResult?.rows ?? [];
    if (!detailEventFilters.length) return rows;
    return rows.filter((row) => detailEventFilters.includes(row.event));
  }, [detailEventFilters, simpleResult?.rows]);
  const detailRows = useMemo(
    () =>
      filteredDetailRows.slice(
        (detailPage - 1) * BACKTEST_DETAIL_PAGE_SIZE,
        detailPage * BACKTEST_DETAIL_PAGE_SIZE,
      ),
    [detailPage, filteredDetailRows],
  );

  useEffect(() => {
    setDetailPage(1);
    setDetailEventFilters([]);
  }, [detail?.id]);

  useEffect(() => {
    if (!workspace.isFetched || workspaceRestored) return;
    const saved = workspace.data;
    if (saved) {
      form.setFieldsValue(saved.request);
      setRangePreset(saved.request.rangeYears ?? "custom");
      setChartMetric(saved.chartMetric);
      setCandlePeriod(saved.candlePeriod);
      setChartSymbol(saved.chartSymbol);
      setActiveExperimentId(saved.activeExperimentId);
    }
    setWorkspaceRestored(true);
  }, [form, workspace.data, workspace.isFetched, workspaceRestored]);

  useEffect(() => {
    if (!workspaceRestored) return;
    const timer = window.setTimeout(() => {
      const values = form.getFieldsValue();
      if (!values.symbols?.length) return;
      void api.saveBacktestWorkspace({
        request: {
          ...values,
          rangeYears: rangePreset === "custom" ? undefined : rangePreset,
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
    endDate,
    form,
    buyDay,
    monthlyAmount,
    rangePreset,
    selectedSymbols,
    startDate,
    workspaceRestored,
  ]);

  const rankedResults = useMemo(
    () =>
      [...results].sort(
        (a, b) =>
          (b.metrics.xirr ?? Number.NEGATIVE_INFINITY) -
          (a.metrics.xirr ?? Number.NEGATIVE_INFINITY),
      ),
    [results],
  );

  useEffect(() => {
    if (results.length && !results.some((result) => result.symbol === chartSymbol)) {
      setChartSymbol(results[0].symbol);
    }
  }, [chartSymbol, results]);

  const metrics = useMemo(() => {
    const endingAsset = [...results].sort(
      (a, b) => b.metrics.endingAsset - a.metrics.endingAsset,
    )[0];
    const xirrWinner = [...results].sort(
      (a, b) => (b.metrics.xirr ?? Number.NEGATIVE_INFINITY) -
        (a.metrics.xirr ?? Number.NEGATIVE_INFINITY),
    )[0];
    const deepestDrawdown = [...results].sort(
      (a, b) => a.metrics.maxDrawdown - b.metrics.maxDrawdown,
    )[0];
    const longestDrawdown = [...results].sort(
      (a, b) => longestDrawdownMonths(b) - longestDrawdownMonths(a),
    )[0];
    const dividendWinner = [...results].sort(
      (a, b) => b.metrics.totalDividend - a.metrics.totalDividend,
    )[0];
    const longestPeriod = longestDrawdown
      ? longestDrawdownPeriod(longestDrawdown)
      : null;

    return [
      {
        label: "累计投入",
        value: results[0] ? money(results[0].metrics.totalContribution) : "—",
        helper: "",
        icon: <DollarOutlined />,
        tone: "blue",
      },
      {
        label: "最终资产（最高）",
        value: endingAsset ? money(endingAsset.metrics.endingAsset) : "—",
        helper: endingAsset?.name ?? "",
        icon: <RiseOutlined />,
        tone: "orange",
      },
      {
        label: "XIRR（最高）",
        value: xirrWinner ? percent(xirrWinner.metrics.xirr) : "—",
        helper: xirrWinner?.name ?? "",
        icon: <TrophyFilled />,
        tone: "coral",
      },
      {
        label: "累计分红（最高）",
        value: dividendWinner ? money(dividendWinner.metrics.totalDividend) : "—",
        helper: dividendWinner?.name ?? "",
        icon: <GiftOutlined />,
        tone: "amber",
      },
      {
        label: "最大回撤",
        value: deepestDrawdown ? percent(deepestDrawdown.metrics.maxDrawdown) : "—",
        helper: deepestDrawdown?.name ?? "",
        icon: <FallOutlined />,
        tone: "teal",
      },
      {
        label: "最长亏损时间",
        value: longestPeriod ? `${longestPeriod.months} 个月` : "—",
        helper:
          longestPeriod?.start && longestPeriod.end
            ? `${longestPeriod.start.slice(0, 7)} → ${longestPeriod.end.slice(0, 7)}`
            : longestDrawdown?.name ?? "",
        icon: <ClockCircleOutlined />,
        tone: "indigo",
      },
    ];
  }, [rankedResults, results]);

  const chartOption = useMemo(() => {
    if (chartMetric === "kline") {
      const focus =
        results.find((result) => result.symbol === chartSymbol) ?? rankedResults[0];
      const candles = focus
        ? toCandles(resultPrices(focus), candlePeriod)
        : [];
      const closes = candles.map((point) => point.close);
      return {
        animationDuration: 320,
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "cross" },
          backgroundColor: "#ffffff",
          borderColor: "#dfe6ef",
          borderWidth: 1,
          textStyle: { color: "#183251", fontSize: 12 },
          extraCssText:
            "box-shadow: 0 10px 28px -10px rgba(20,42,76,.28);border-radius:6px;",
        },
        legend: {
          top: 3,
          left: 20,
          itemWidth: 17,
          itemHeight: 2,
          itemGap: 24,
          data: ["收盘价（不复权）", "MA5", "MA10", "MA20", "MA60"],
          textStyle: { color: "#64758c", fontSize: 11 },
        },
        grid: { left: 14, right: 14, top: 40, bottom: 17, containLabel: true },
        xAxis: {
          type: "category",
          boundaryGap: true,
          data: candles.map((point) => point.date),
          axisLabel: {
            hideOverlap: true,
            color: "#5d6f87",
            fontSize: 10,
            formatter: (value: string) => value.slice(0, 7),
          },
          axisLine: { lineStyle: { color: "#dce4ed" } },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          scale: true,
          axisLabel: {
            color: "#5d6f87",
            fontSize: 10,
            formatter: (value: number) => value.toFixed(2),
          },
          splitLine: { lineStyle: { color: "#e9eef4", type: "dashed" } },
        },
        series: [
          {
            name: "收盘价（不复权）",
            type: "candlestick",
            data: candles.map((point) => [
              point.open,
              point.close,
              point.low,
              point.high,
            ]),
            itemStyle: {
              color: "#f04438",
              color0: "#13a68f",
              borderColor: "#f04438",
              borderColor0: "#13a68f",
            },
          },
          ...[
            [5, "#f59b17"],
            [10, "#377dff"],
            [20, "#1677ff"],
            [60, "#13a68f"],
          ].map(([window, color]) => ({
            name: `MA${window}`,
            type: "line",
            showSymbol: false,
            smooth: 0.1,
            data: movingAverage(closes, Number(window)),
            lineStyle: { width: 1.3, color },
            itemStyle: { color },
          })),
        ],
      };
    }

    const baseCurve = results[0]?.equityCurve ?? [];
    const series = results.map((result, index) => {
      let peak = Number.NEGATIVE_INFINITY;
      return {
        name: result.name,
        type: "line",
        showSymbol: false,
        smooth: 0.08,
        data: result.equityCurve.map((point) => {
          if (chartMetric === "return") {
            return point.contribution ? point.asset / point.contribution - 1 : 0;
          }
          const value = point.nav ?? point.asset;
          peak = Math.max(peak, value);
          return peak ? value / peak - 1 : 0;
        }),
        lineStyle: {
          width: 1.8,
          color: CHART_COLORS[index],
          type: undefined as "dashed" | undefined,
        },
        itemStyle: { color: CHART_COLORS[index] },
        emphasis: { focus: "series" },
      };
    });

    return {
      animationDuration: 420,
      tooltip: {
        trigger: "axis",
        backgroundColor: "#ffffff",
        borderColor: "#dfe6ef",
        borderWidth: 1,
        padding: [9, 12],
        textStyle: { color: "#183251", fontSize: 11 },
        extraCssText:
          "box-shadow: 0 10px 28px -10px rgba(20,42,76,.28);border-radius:6px;",
        valueFormatter: (value: number) => percent(value),
      },
      grid: { left: 14, right: 12, top: 38, bottom: 18, containLabel: true },
      legend: {
        top: 2,
        left: 28,
        icon: "roundRect",
        itemWidth: 16,
        itemHeight: 2,
        itemGap: 24,
        textStyle: { color: "#64758c", fontSize: 11 },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: baseCurve.map((point) => point.date),
        axisLabel: {
          hideOverlap: true,
          color: "#5d6f87",
          fontSize: 10,
          formatter: (value: string) => value.slice(0, 7),
        },
        axisLine: { lineStyle: { color: "#dce4ed" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        scale: false,
        axisLabel: {
          color: "#5d6f87",
          fontSize: 10,
          formatter: (value: number) => `${Math.round(value * 100)}%`,
        },
        splitLine: { lineStyle: { color: "#e9eef4" } },
      },
      series,
      color: CHART_COLORS,
    };
  }, [candlePeriod, chartMetric, chartSymbol, rankedResults, results]);

  const beginDraft = () => {
    setActiveExperimentId(undefined);
    setCurrentExperiment(null);
    setViewingReadonly(false);
  };

  const setDatePreset = (years: 3 | 5 | 10 | 15) => {
    beginDraft();
    setRangePreset(years);
    form.setFieldsValue({ startDate: dateYearsAgo(years), endDate: today() });
  };

  const copyBacktestRequest = (request: BacktestRequest) => {
    form.setFieldsValue(request);
    setRangePreset(request.rangeYears ?? "custom");
    setChartSymbol(request.symbols[0] ?? chartSymbol);
    setActiveExperimentId(undefined);
    setCurrentExperiment(null);
    setViewingReadonly(false);
    setPageTab("run");
    message.success("已复制实验参数；修改后可开始新的回测");
  };
  const copyExperimentRequest = (experiment: BacktestExperimentSummary) =>
    copyBacktestRequest(experiment.request);

  const metricTabs: Array<[BacktestChartMetric, string]> = [
    ["kline", "行情K线"],
    ["return", "收益率曲线"],
    ["drawdown", "最大回撤曲线"],
  ];
  const candlePeriods: Array<[BacktestCandlePeriod, string]> = [
    ["day", "日K"],
    ["week", "周K"],
    ["month", "月K"],
  ];

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
        <BacktestHistoryPanel
          experiments={experiments.data ?? []}
          loading={experiments.isLoading}
          deletingId={
            deleteExperimentMutation.isPending
              ? deleteExperimentMutation.variables
              : undefined
          }
          onView={(experiment) =>
            openExperimentMutation.mutate(experiment.experimentId)
          }
          onCopy={copyExperimentRequest}
          onDelete={(experiment) =>
            deleteExperimentMutation.mutate(experiment.experimentId)
          }
        />
      ) : (
        <>
          {viewingReadonly && activeExperiment ? (
            <div className="experiment-readonly-banner">
              <div>
                <strong>正在查看历史实验</strong>
                <span>
                  {new Date(activeExperiment.createdAt).toLocaleString("zh-CN")} ·
                  数据截止 {activeExperiment.dataCutoff} · 参数与结果只读
                </span>
              </div>
              <Button
                size="small"
                onClick={() => copyBacktestRequest(activeExperiment.request)}
              >
                复制参数重新回测
              </Button>
            </div>
          ) : null}

          <section className="workspace-panel backtest-config">
        <Form
          form={form}
          disabled={viewingReadonly}
          layout="vertical"
          initialValues={{
            symbols: [...DEFAULT_BACKTEST_SYMBOLS],
            startDate: dateYearsAgo(3),
            endDate: today(),
            monthlyAmount: 3000,
            buyDay: 1,
            rangeYears: 3,
            caliberVersion: BACKTEST_CALIBER_VERSION,
          }}
          onFinish={(values) =>
            mutation.mutate({
              ...values,
              rangeYears: rangePreset === "custom" ? undefined : rangePreset,
            })
          }
          onValuesChange={() => {
            if (activeExperimentId) beginDraft();
          }}
        >
          <Form.Item name="buyDay" hidden>
            <InputNumber />
          </Form.Item>
          <Form.Item name="caliberVersion" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="startDate" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="endDate" hidden>
            <Input />
          </Form.Item>
          <div className="backtest-config-grid">
            <div className="symbol-field">
              <div className="field-label required-label">标的选择</div>
              <div className="symbol-control-row">
                <Form.Item
                  name="symbols"
                  rules={[{ required: true, message: "至少选择一个标的" }]}
                  className="!mb-0 min-w-0 flex-1"
                >
                  <Select
                    mode="multiple"
                    maxCount={BACKTEST_MAX_SYMBOLS}
                    maxTagCount="responsive"
                    options={stockOptions}
                    placeholder={
                      stocks.isLoading ? "正在加载 A 股列表…" : "输入名称或代码搜索"
                    }
                    className="backtest-symbol-select"
                    open={symbolPickerOpen}
                    onOpenChange={setSymbolPickerOpen}
                    showSearch
                    filterOption={(input, option) =>
                      String(option?.searchText ?? "").includes(
                        input.trim().toLocaleLowerCase("zh-CN"),
                      )
                    }
                    optionRender={(option) => (
                      <div className="stock-option">
                        <span>{option.data.label}</span>
                        <small className="tabular-nums">{option.value}</small>
                      </div>
                    )}
                    notFoundContent={
                      stocks.isLoading ? (
                        <Skeleton active paragraph={{ rows: 2 }} title={false} />
                      ) : stocks.isError ? (
                        <div className="stock-universe-error">
                          <span>全 A 股目录加载失败</span>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => void stocks.refetch()}
                          >
                            重试
                          </Button>
                        </div>
                      ) : (
                        "未找到匹配的 A 股"
                      )
                    }
                  />
                </Form.Item>
                <Button
                  type="default"
                  size="small"
                  icon={<PlusOutlined />}
                  className="add-symbol-button"
                  disabled={
                    viewingReadonly ||
                    selectedSymbols.length >= BACKTEST_MAX_SYMBOLS
                  }
                  onClick={() => setSymbolPickerOpen(true)}
                >
                  添加标的
                </Button>
              </div>
            </div>

            <div className="backtest-range">
              <div className="field-label">回测区间</div>
              <div className="range-control-row">
                <div className="range-shortcuts" aria-label="快捷回测区间">
                  {BACKTEST_RANGE_YEARS.map((range) => (
                    <button
                      key={range}
                      type="button"
                      disabled={viewingReadonly}
                      className={rangePreset === range ? "active" : ""}
                      onClick={() => setDatePreset(range)}
                    >
                      {range}年
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Form.Item name="monthlyAmount" label="每月投入金额" className="!mb-0">
              <InputNumber<number>
                min={100}
                step={500}
                precision={2}
                suffix="元"
                className="w-full"
                formatter={(value) =>
                  value === undefined
                    ? ""
                    : Number(value).toLocaleString("zh-CN", {
                        minimumFractionDigits: 2,
                      })
                }
                parser={(value) => Number(value?.replaceAll(",", "") ?? 0)}
              />
            </Form.Item>

            <div>
              <div className="field-label fee-label">
                <span>费用模式</span>
                <Popover
                  placement="bottomRight"
                  trigger="click"
                  content={
                    <div className="advanced-settings">
                      <label htmlFor="advanced-start-date">开始日期</label>
                      <Input
                        id="advanced-start-date"
                        type="date"
                        value={startDate}
                        onChange={(event) => {
                          beginDraft();
                          form.setFieldValue("startDate", event.target.value);
                          setRangePreset("custom");
                        }}
                      />
                      <label htmlFor="advanced-end-date">结束日期</label>
                      <Input
                        id="advanced-end-date"
                        type="date"
                        value={endDate}
                        onChange={(event) => {
                          beginDraft();
                          form.setFieldValue("endDate", event.target.value);
                          setRangePreset("custom");
                        }}
                      />
                      <label htmlFor="advanced-buy-day">指定买入日</label>
                      <InputNumber
                        id="advanced-buy-day"
                        min={1}
                        max={28}
                        value={buyDay}
                        suffix="日"
                        onChange={(value) => {
                          beginDraft();
                          form.setFieldValue("buyDay", value ?? 1);
                        }}
                      />
                      <p>非交易日自动顺延到下一交易日。</p>
                    </div>
                  }
                >
                  <button
                    type="button"
                    className="inline-link compact"
                    disabled={viewingReadonly}
                  >
                    <SettingOutlined />
                    高级设置
                  </button>
                </Popover>
              </div>
              <div className="fee-mode-display" aria-label="费用模式：R1 简化费用 0 元">
                R1 简化费用（0 元）
              </div>
            </div>

            <Button
              type="primary"
              htmlType="submit"
              loading={mutation.isPending}
              className="start-backtest-button"
            >
              开始回测
            </Button>
          </div>
          {rulesExpanded && (
            <div className="backtest-rules-expanded">
              不复权收盘价；允许零碎股；指定买入日遇非交易日顺延；送股与转增按除权日增加股数；
              现金分红到账后立即全额回购原标的；费用 0 元，不计印花税和过户费。
            </div>
          )}
        </Form>
      </section>

      <section className="workspace-panel backtest-metrics" aria-label="回测概览">
        {metrics.map((metric) => (
          <div className="backtest-metric" key={metric.label}>
            <span className={`metric-icon ${metric.tone}`}>{metric.icon}</span>
            <div className="min-w-0">
              <div className="metric-caption">{metric.label}</div>
              <div className="metric-number tabular-nums">{metric.value}</div>
              <div className="metric-helper">{metric.helper || "\u00a0"}</div>
            </div>
          </div>
        ))}
      </section>

      <section className="workspace-panel backtest-chart-panel">
        <div className="chart-toolbar">
          <div className="chart-metric-tabs" role="tablist" aria-label="图表指标">
            {metricTabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={chartMetric === key}
                className={chartMetric === key ? "active" : ""}
                onClick={() => setChartMetric(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="chart-actions">
            {chartMetric === "kline" && (
              <div className="chart-range-tabs" aria-label="K线周期">
                {candlePeriods.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={candlePeriod === key ? "active" : ""}
                    onClick={() => setCandlePeriod(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <Tooltip title="导出对比结果">
              <Button
                aria-label="导出对比结果"
                icon={<DownloadOutlined />}
                loading={exportMutation.isPending}
                disabled={!activeExperiment}
                onClick={() =>
                  activeExperiment &&
                  exportMutation.mutate(activeExperiment.experimentId)
                }
              >
                导出
              </Button>
            </Tooltip>
          </div>
        </div>
        {chartMetric === "kline" && results.length > 0 && (
          <div className="chart-symbol-switcher" aria-label="行情标的切换">
            <span>标的切换：</span>
            {results.map((result) => (
              <label key={result.symbol}>
                <input
                  type="radio"
                  name="chart-symbol"
                  value={result.symbol}
                  checked={chartSymbol === result.symbol}
                  onChange={() => setChartSymbol(result.symbol)}
                />
                <span>{result.name}</span>
              </label>
            ))}
          </div>
        )}
        {persistedExperiment.isLoading && !results.length ? (
          <div className="chart-loading">
            <Skeleton active paragraph={{ rows: 5 }} title={false} />
          </div>
        ) : !results.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="设置参数并开始回测后，将在这里展示行情与收益曲线"
            className="chart-empty"
          />
        ) : (
          <ReactECharts
            notMerge
            option={chartOption}
            className="backtest-chart"
            style={{ height: chartMetric === "kline" ? 270 : 300 }}
          />
        )}
      </section>

      <section className="workspace-panel comparison-panel">
        <div className="comparison-title">
          <div>
            <strong>本次实验结果（按 XIRR 排序）</strong>
            <span>只比较同一请求、同一数据截止时间下的标的结果</span>
          </div>
          {activeExperiment ? (
            <small className="tabular-nums">
              运行于 {new Date(activeExperiment.createdAt).toLocaleString("zh-CN")}
              {" · "}
              数据截止 {activeExperiment.dataCutoff}
            </small>
          ) : null}
        </div>
        <Table
          className="comparison-table"
          rowKey="id"
          pagination={false}
          loading={persistedExperiment.isLoading}
          dataSource={rankedResults}
          locale={{ emptyText: "设置参数并开始回测后，将在这里展示标的对比" }}
          scroll={{ x: 1320 }}
          onRow={(record) => ({
            onDoubleClick: () => setDetail(record),
            className: "data-row",
          })}
          columns={[
            {
              title: "排名",
              width: 58,
              align: "center",
              render: (_, _row, index) => (
                <span className={`rank rank-${index + 1}`}>
                  {index + 1}
                  <TrophyFilled />
                </span>
              ),
            },
            {
              title: "标的",
              width: 144,
              render: (_, row) => (
                <div className="symbol-cell">
                  <strong>{row.name}</strong>
                  <span className="tabular-nums">{row.symbol}</span>
                </div>
              ),
            },
            {
              title: "累计投入",
              width: 106,
              className: "tabular-nums",
              render: (_, row) => money(row.metrics.totalContribution),
            },
            {
              title: "最终资产",
              width: 106,
              className: "tabular-nums",
              render: (_, row) => money(row.metrics.endingAsset),
            },
            {
              title: "XIRR",
              width: 92,
              className: "tabular-nums",
              render: (_, row) => (
                <span
                  className={
                    row.metrics.xirr === null || row.metrics.xirr === 0
                      ? "stock-flat"
                      : row.metrics.xirr > 0
                        ? "stock-profit"
                        : "stock-loss"
                  }
                >
                  {percent(row.metrics.xirr)}
                </span>
              ),
            },
            {
              title: "累计分红",
              width: 104,
              className: "tabular-nums",
              render: (_, row) => money(row.metrics.totalDividend),
            },
            {
              title: "最大回撤",
              width: 96,
              className: "tabular-nums",
              render: (_, row) => (
                <span className="stock-loss">{percent(row.metrics.maxDrawdown)}</span>
              ),
            },
            {
              title: "最长亏损时间",
              width: 128,
              className: "tabular-nums",
              render: (_, row) => {
                const period = longestDrawdownPeriod(row);
                return (
                  <div className="drawdown-period">
                    <span>{period.months} 个月</span>
                    {period.start && period.end && (
                      <small>
                        {period.start.slice(0, 7)} → {period.end.slice(0, 7)}
                      </small>
                    )}
                  </div>
                );
              },
            },
            {
              title: "期末现金",
              width: 98,
              className: "tabular-nums",
              render: (_, row) => money(row.metrics.endingCash),
            },
            {
              title: "操作",
              width: 88,
              fixed: "right",
              render: (_, row) => (
                <Button
                  type="link"
                  size="small"
                  className="view-detail-button"
                  onClick={() => setDetail(row)}
                >
                  查看详情
                  <span>›</span>
                </Button>
              ),
            },
          ]}
        />
        <div className="comparison-footer">
          <span>本次实验共 {rankedResults.length} 个标的</span>
        </div>
      </section>
        </>
      )}

      <Modal
        title={
          detail ? (
            <div className="detail-modal-title">
              <span>{detail.name}</span>
              <span className="tabular-nums">{detail.symbol}</span>
              <i />
              <span>回测明细</span>
            </div>
          ) : (
            "回测明细"
          )
        }
        width={1280}
        open={Boolean(detail)}
        footer={null}
        style={{ top: 38 }}
        destroyOnHidden
        className="backtest-detail-modal"
        rootClassName="backtest-detail-root"
        onCancel={() => setDetail(null)}
      >
        {detail && (
          <div className="detail-modal-body">
            <div className="detail-summary">
              {[
                [
                  "实际区间",
                  `${simpleResult?.actualStartDate ?? detail.actualStartDate} — ${
                    simpleResult?.actualEndDate ?? detail.actualEndDate
                  }`,
                ],
                ["明细条数", `${simpleResult?.rows.length ?? 0} 条`],
                ["累计外部投入", money(simpleResult?.endingCost ?? 0), ""],
                ["累计分红（税后）", money(simpleResult?.totalDividendAmount ?? 0), ""],
                [
                  "当前盈亏率",
                  percent(simpleResult?.returnRate ?? null),
                  simpleResult?.returnRate === undefined || simpleResult.returnRate === 0
                    ? ""
                    : simpleResult.returnRate > 0
                      ? "stock-profit"
                      : "stock-loss",
                ],
              ].map(([label, value, tone]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong className={`tabular-nums ${tone}`}>{value}</strong>
                </div>
              ))}
            </div>

            {simpleQuery.isLoading && (
              <div className="detail-loading">
                <Skeleton active paragraph={{ rows: 8 }} />
              </div>
            )}
            {simpleQuery.isError && (
              <div className="detail-error">
                加载失败：
                {simpleQuery.error instanceof Error ? simpleQuery.error.message : "未知错误"}
              </div>
            )}
            {simpleResult && (
              <Table
                size="small"
                rowKey={(row, index) => `${row.date}-${row.event}-${index ?? 0}`}
                pagination={false}
                onChange={(_, filters) => {
                  const events = (filters.event ?? []) as SimpleBacktestRow["event"][];
                  setDetailEventFilters(events);
                  setDetailPage(1);
                }}
                dataSource={detailRows}
                tableLayout="fixed"
                columns={[
                  {
                    title: "日期",
                    dataIndex: "date",
                    width: 96,
                    className: "tabular-nums",
                  },
                  {
                    title: "事件",
                    dataIndex: "event",
                    width: 60,
                    render: (event: SimpleBacktestRow["event"]) => (
                      <Tag color={EVENT_COLORS[event]} bordered={false}>
                        {EVENT_LABELS[event]}
                      </Tag>
                    ),
                    filters: Object.entries(EVENT_LABELS).map(([value, label]) => ({
                      text: label,
                      value,
                    })),
                    filteredValue: detailEventFilters.length
                      ? detailEventFilters
                      : null,
                  },
                  {
                    title: "期初现金",
                    dataIndex: "openingCash",
                    width: 108,
                    align: "right",
                    className: "tabular-nums",
                    render: (value: number) => money(value),
                  },
                  {
                    title: "外部投入",
                    dataIndex: "externalContribution",
                    width: 96,
                    align: "right",
                    className: "tabular-nums",
                    render: (value: number) => value > 0 ? money(value) : "—",
                  },
                  {
                    title: "收盘价",
                    dataIndex: "price",
                    width: 82,
                    align: "right",
                    className: "tabular-nums",
                    render: (value: number) => value.toFixed(2),
                  },
                  {
                    title: "新增股数",
                    dataIndex: "shares",
                    width: 92,
                    align: "right",
                    className: "tabular-nums",
                    render: (value: number, row) =>
                      row.event === "dividend" ? "—" : value.toFixed(2),
                  },
                  {
                    title: "发生金额",
                    width: 108,
                    align: "right",
                    className: "tabular-nums",
                    render: (_, row) => {
                      if (row.event === "share_adjustment") {
                        return `每10股 +${row.shareRatio?.toFixed(4) ?? "—"}`;
                      }
                      if (row.event === "dividend") {
                        return money(row.dividendAmount ?? 0);
                      }
                      return money(row.tradeAmount);
                    },
                  },
                  {
                    title: "累计股数",
                    dataIndex: "cumulativeShares",
                    width: 100,
                    align: "right",
                    className: "tabular-nums",
                    render: (value: number) => value.toFixed(2),
                  },
                  {
                    title: "累计投入",
                    dataIndex: "cumulativeContribution",
                    width: 108,
                    align: "right",
                    className: "tabular-nums",
                    render: (value: number) => money(value),
                  },
                  {
                    title: "累计分红",
                    dataIndex: "cumulativeDividend",
                    width: 108,
                    align: "right",
                    className: "tabular-nums",
                    render: (value: number) => money(value),
                  },
                  {
                    title: "期末现金",
                    dataIndex: "endingCash",
                    width: 98,
                    align: "right",
                    className: "tabular-nums",
                    render: (value: number) => money(value),
                  },
                  {
                    title: "盈亏率",
                    dataIndex: "returnRate",
                    width: 82,
                    align: "right",
                    className: "tabular-nums",
                    render: (value: number) => (
                      <span
                        className={
                          value === 0
                            ? "stock-flat"
                            : value > 0
                              ? "stock-profit"
                              : "stock-loss"
                        }
                      >
                        {percent(value)}
                      </span>
                    ),
                  },
                ]}
              />
            )}

            <div className="detail-modal-footer">
              <div className="detail-source-meta">
                <strong>数据来源：</strong>
                <span>{detail.provenance.map((item) => item.source).join(" · ")}</span>
                <i />
                <strong>更新时间：</strong>
                <span className="tabular-nums">{detail.actualEndDate}</span>
              </div>
              <div className="detail-pagination-controls">
                <span className="detail-total tabular-nums">
                  共 {filteredDetailRows.length} 条
                </span>
                <Select
                  aria-label="每页条数"
                  size="small"
                  value={BACKTEST_DETAIL_PAGE_SIZE}
                  options={[
                    {
                      value: BACKTEST_DETAIL_PAGE_SIZE,
                      label: `${BACKTEST_DETAIL_PAGE_SIZE}条/页`,
                    },
                  ]}
                  className="detail-page-size"
                />
                <Pagination
                  size="small"
                  current={detailPage}
                  pageSize={BACKTEST_DETAIL_PAGE_SIZE}
                  total={filteredDetailRows.length}
                  showSizeChanger={false}
                  hideOnSinglePage={false}
                  onChange={setDetailPage}
                />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
