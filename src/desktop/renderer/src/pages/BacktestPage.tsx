import { useMemo, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Select,
  Skeleton,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CalendarOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  DownloadOutlined,
  GiftOutlined,
  InfoCircleOutlined,
  LineChartOutlined,
  PlusOutlined,
  ReloadOutlined,
  RiseOutlined,
  SettingOutlined,
  TrophyFilled,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  api,
  type BacktestRequest,
  type BacktestResult,
  type SimpleBacktestResult,
  type SimpleBacktestRow,
} from "../api/client";

const { Text } = Typography;

const BANKS = [
  ["601398", "工商银行"],
  ["601939", "建设银行"],
  ["601288", "农业银行"],
  ["601988", "中国银行"],
  ["600036", "招商银行"],
  ["601166", "兴业银行"],
  ["600016", "民生银行"],
] as const;

const BANK_OPTIONS = BANKS.map(([value, name]) => ({
  value,
  label: `${name}　${value}`,
}));

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

const CHART_COLORS = ["#1677ff", "#ff9f1a", "#12a594", "#7c6cf2"];

type ChartMetric = "asset" | "return" | "drawdown";
type ChartRange = "all" | 1 | 3 | 5 | "max";

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

function totalReturn(result: BacktestResult): number {
  return result.metrics.totalContribution
    ? result.metrics.totalPnl / result.metrics.totalContribution
    : 0;
}

function longestDrawdownMonths(result: BacktestResult): number {
  let peak = Number.NEGATIVE_INFINITY;
  let drawdownStart: string | null = null;
  let longestDays = 0;

  for (const point of result.equityCurve) {
    const value = point.nav ?? point.asset;
    if (value >= peak) {
      if (drawdownStart) {
        longestDays = Math.max(
          longestDays,
          (Date.parse(point.date) - Date.parse(drawdownStart)) / 86_400_000,
        );
      }
      peak = value;
      drawdownStart = null;
    } else if (!drawdownStart) {
      drawdownStart = point.date;
    }
  }

  if (drawdownStart && result.actualEndDate) {
    longestDays = Math.max(
      longestDays,
      (Date.parse(result.actualEndDate) - Date.parse(drawdownStart)) / 86_400_000,
    );
  }
  return Math.max(0, Math.round(longestDays / 30.4375));
}

function deriveSimpleRequest(record: BacktestResult): BacktestRequest {
  return {
    symbols: [record.symbol],
    startDate: record.requestedStartDate || record.actualStartDate,
    endDate: record.actualEndDate,
    monthlyAmount: record.monthlyAmount,
    buyDay: record.buyDay,
  };
}

function downloadComparison(results: BacktestResult[]): void {
  if (!results.length) return;
  const rows = [
    [
      "标的",
      "代码",
      "累计投入",
      "最终资产",
      "累计收益",
      "累计收益率",
      "XIRR",
      "最大回撤",
      "最长亏损时间（月）",
      "累计分红",
      "期末现金",
    ],
    ...results.map((result) => [
      result.name,
      result.symbol,
      result.metrics.totalContribution,
      result.metrics.endingAsset,
      result.metrics.totalPnl,
      totalReturn(result),
      result.metrics.xirr ?? "",
      result.metrics.maxDrawdown,
      longestDrawdownMonths(result),
      result.metrics.totalDividend,
      result.metrics.endingCash,
    ]),
  ];
  const csv = rows
    .map((row) =>
      row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `回测对比-${today()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function BacktestPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<BacktestRequest>();
  const [currentResults, setCurrentResults] = useState<BacktestResult[]>([]);
  const [currentRequest, setCurrentRequest] = useState<BacktestRequest | null>(null);
  const [detail, setDetail] = useState<BacktestResult | null>(null);
  const [rangePreset, setRangePreset] = useState<3 | 5 | 10 | "custom">("custom");
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("asset");
  const [chartRange, setChartRange] = useState<ChartRange>("all");
  const buyDay = Form.useWatch("buyDay", form) ?? 1;

  const history = useQuery({
    queryKey: ["backtests"],
    queryFn: api.listBacktests,
  });

  const mutation = useMutation({
    mutationFn: api.runBacktest,
    onSuccess: (results, variables) => {
      setCurrentResults(results);
      setCurrentRequest(variables);
      void queryClient.invalidateQueries({ queryKey: ["backtests"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      message.success(`已完成 ${results.length} 个标的回测`);
    },
    onError: (error) => message.error(error.message),
  });

  const simpleRequest = useMemo<BacktestRequest | null>(() => {
    if (!detail) return null;
    if (currentRequest) return { ...currentRequest, symbols: [detail.symbol] };
    return deriveSimpleRequest(detail);
  }, [detail, currentRequest]);

  const simpleQuery = useQuery({
    queryKey: ["backtest:simple", simpleRequest],
    queryFn: () => api.runSimpleBacktest(simpleRequest!),
    enabled: Boolean(simpleRequest),
    staleTime: 60_000,
  });

  const simpleResult: SimpleBacktestResult | undefined = useMemo(
    () => simpleQuery.data?.find((row) => row.symbol === detail?.symbol),
    [simpleQuery.data, detail?.symbol],
  );

  const results = useMemo(
    () => currentResults.length ? currentResults : history.data?.slice(0, 4) ?? [],
    [currentResults, history.data],
  );

  const rankedResults = useMemo(
    () => [...results].sort((a, b) => b.metrics.endingAsset - a.metrics.endingAsset),
    [results],
  );

  const metrics = useMemo(() => {
    const endingAsset = rankedResults[0];
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

    return [
      {
        label: "每个标的累计投入",
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
        label: "最大回撤（最低）",
        value: deepestDrawdown ? percent(deepestDrawdown.metrics.maxDrawdown) : "—",
        helper: deepestDrawdown?.name ?? "",
        icon: <LineChartOutlined />,
        tone: "teal",
      },
      {
        label: "最长亏损时间（最短）",
        value: longestDrawdown ? `${longestDrawdownMonths(longestDrawdown)} 个月` : "—",
        helper: longestDrawdown?.name ?? "",
        icon: <ClockCircleOutlined />,
        tone: "indigo",
      },
      {
        label: "累计分红（最高）",
        value: dividendWinner ? money(dividendWinner.metrics.totalDividend) : "—",
        helper: dividendWinner?.name ?? "",
        icon: <GiftOutlined />,
        tone: "amber",
      },
    ];
  }, [rankedResults, results]);

  const chartOption = useMemo(() => {
    const latestDate = results[0]?.equityCurve.at(-1)?.date;
    const cutoff =
      latestDate && typeof chartRange === "number"
        ? new Date(
            new Date(latestDate).setFullYear(new Date(latestDate).getFullYear() - chartRange),
          )
            .toISOString()
            .slice(0, 10)
        : null;
    const visibleCurve = (result: BacktestResult) =>
      result.equityCurve.filter((point) => !cutoff || point.date >= cutoff);
    const baseCurve = results[0] ? visibleCurve(results[0]) : [];

    const series = results.map((result, index) => {
      let peak = 0;
      return {
        name: result.name,
        type: "line",
        showSymbol: false,
        smooth: 0.08,
        data: visibleCurve(result).map((point) => {
          if (chartMetric === "asset") return point.asset;
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

    if (chartMetric === "asset" && baseCurve.length) {
      series.push({
        name: "累计投入（每个标的）",
        type: "line",
        showSymbol: false,
        smooth: 0,
        data: baseCurve.map((point) => point.contribution),
        lineStyle: { width: 1.3, color: "#8799b3", type: "dashed" },
        itemStyle: { color: "#8799b3" },
        emphasis: { focus: "series" },
      });
    }

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
        valueFormatter: (value: number) =>
          chartMetric === "asset" ? money(value) : percent(value),
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
          color: "#71839b",
          fontSize: 10,
          formatter: (value: string) => value.slice(0, 7),
        },
        axisLine: { lineStyle: { color: "#dce4ed" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        scale: chartRange === "max",
        axisLabel: {
          color: "#71839b",
          fontSize: 10,
          formatter: (value: number) =>
            chartMetric === "asset"
              ? value === 0 ? "0" : `${Math.round(value / 10_000)}万`
              : `${Math.round(value * 100)}%`,
        },
        splitLine: { lineStyle: { color: "#e9eef4" } },
      },
      series,
      color: CHART_COLORS,
    };
  }, [chartMetric, chartRange, results]);

  const detailYears = useMemo(
    () =>
      Array.from(new Set(simpleResult?.rows.map((row) => row.date.slice(0, 4)) ?? []))
        .sort()
        .map((year) => ({ text: year, value: year })),
    [simpleResult],
  );

  const setDatePreset = (years: 3 | 5 | 10 | "custom") => {
    setRangePreset(years);
    if (years !== "custom") {
      form.setFieldsValue({ startDate: dateYearsAgo(years), endDate: today() });
    }
  };

  const metricTabs: Array<[ChartMetric, string]> = [
    ["asset", "资产曲线"],
    ["return", "收益率曲线"],
    ["drawdown", "回撤曲线"],
  ];
  const chartRanges: Array<[ChartRange, string]> = [
    ["all", "全部"],
    [1, "1年"],
    [3, "3年"],
    [5, "5年"],
    ["max", "最大"],
  ];

  return (
    <div className="backtest-page">
      <header className="page-heading backtest-heading">
        <h1>历史回测</h1>
        <div className="flex items-center gap-5">
          <p>固定金额、允许零碎股、分红再投资，长期定投收益与风险分析</p>
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

      <section className="workspace-panel backtest-config">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            symbols: ["601398", "601288", "601166"],
            startDate: dateYearsAgo(5),
            endDate: today(),
            monthlyAmount: 3000,
            buyDay: 1,
          }}
          onFinish={(values) => mutation.mutate(values)}
        >
          <Form.Item name="buyDay" hidden>
            <InputNumber />
          </Form.Item>
          <div className="backtest-config-grid">
            <Form.Item
              name="symbols"
              label="标的选择"
              rules={[{ required: true, message: "至少选择一个标的" }]}
              className="!mb-0 min-w-0"
            >
              <Select
                mode="multiple"
                maxCount={4}
                options={BANK_OPTIONS}
                placeholder="添加标的"
                className="backtest-symbol-select"
                suffixIcon={<PlusOutlined />}
                allowClear
              />
            </Form.Item>

            <div className="backtest-range">
              <div className="field-label">回测区间</div>
              <div className="range-shortcuts" aria-label="快捷回测区间">
                {([3, 5, 10, "custom"] as const).map((range) => (
                  <button
                    key={range}
                    type="button"
                    className={rangePreset === range ? "active" : ""}
                    onClick={() => setDatePreset(range)}
                  >
                    {range === "custom" ? "自定义" : `近${range}年`}
                  </button>
                ))}
              </div>
              <div className="date-range-inputs">
                <Form.Item name="startDate" className="!mb-0">
                  <Input
                    type="date"
                    aria-label="开始日期"
                    onChange={() => setRangePreset("custom")}
                  />
                </Form.Item>
                <span>至</span>
                <Form.Item name="endDate" className="!mb-0">
                  <Input
                    type="date"
                    aria-label="结束日期"
                    onChange={() => setRangePreset("custom")}
                  />
                </Form.Item>
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
                      <label htmlFor="advanced-buy-day">指定买入日</label>
                      <InputNumber
                        id="advanced-buy-day"
                        min={1}
                        max={28}
                        value={buyDay}
                        suffix="日"
                        onChange={(value) => form.setFieldValue("buyDay", value ?? 1)}
                      />
                      <p>非交易日自动顺延到下一交易日。</p>
                    </div>
                  }
                >
                  <button type="button" className="inline-link compact">
                    <SettingOutlined />
                    高级设置
                  </button>
                </Popover>
              </div>
              <Select
                value="zero"
                aria-label="费用模式"
                options={[{ value: "zero", label: "R1 简化费用（0 元）" }]}
                className="w-full"
              />
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

          <div className="backtest-rules">
            <div className="backtest-rule-list">
              <span>回测规则：</span>
              <span>不复权收盘价</span>
              <i />
              <span>允许零碎股</span>
              <i />
              <span>分红再投资（回购原标的）</span>
              <i />
              <span>剩余资金参与后续回购</span>
              <i />
              <span>费用 0 元，不计印花税和过户费</span>
            </div>
            <button
              type="button"
              className="rules-toggle"
              onClick={() => setRulesExpanded((value) => !value)}
            >
              {rulesExpanded ? "收起" : "展开"}
              <span className={rulesExpanded ? "rotate-180" : ""}>⌄</span>
            </button>
          </div>
          {rulesExpanded && (
            <div className="backtest-rules-expanded">
              指定买入日遇非交易日顺延；送股与转增按除权日增加股数；现金分红按登记日持股计算，
              到账后立即全额回购原标的。
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
          <div className="chart-title">资产曲线</div>
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
            <div className="chart-range-tabs" aria-label="图表区间">
              {chartRanges.map(([key, label]) => (
                <button
                  key={String(key)}
                  type="button"
                  className={chartRange === key ? "active" : ""}
                  onClick={() => setChartRange(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="toolbar-divider" />
            <Tooltip title="曲线视图">
              <Button aria-label="曲线视图" icon={<LineChartOutlined />} />
            </Tooltip>
            <Tooltip title="恢复全部区间">
              <Button
                aria-label="恢复全部区间"
                icon={<ReloadOutlined />}
                onClick={() => setChartRange("all")}
              />
            </Tooltip>
            <Tooltip title="导出对比结果">
              <Button
                aria-label="导出对比结果"
                icon={<DownloadOutlined />}
                disabled={!results.length}
                onClick={() => downloadComparison(rankedResults)}
              />
            </Tooltip>
          </div>
        </div>
        {history.isLoading && !results.length ? (
          <div className="chart-loading">
            <Skeleton active paragraph={{ rows: 5 }} title={false} />
          </div>
        ) : (
          <ReactECharts
            notMerge
            option={chartOption}
            className="backtest-chart"
            style={{ height: 235 }}
          />
        )}
      </section>

      <section className="workspace-panel comparison-panel">
        <div className="comparison-title">标的对比</div>
        <Table
          rowKey="id"
          pagination={false}
          loading={history.isLoading && !results.length}
          dataSource={rankedResults}
          locale={{ emptyText: "设置参数并开始回测后，将在这里展示标的对比" }}
          scroll={{ x: 1120 }}
          onRow={(record) => ({
            onDoubleClick: () => setDetail(record),
            className: "data-row",
          })}
          columns={[
            {
              title: "排序",
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
              width: 132,
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
              title: "累计收益",
              width: 106,
              className: "tabular-nums",
              render: (_, row) => money(row.metrics.totalPnl),
            },
            {
              title: "累计收益率",
              width: 90,
              className: "tabular-nums",
              render: (_, row) => percent(totalReturn(row)),
            },
            {
              title: "XIRR",
              width: 82,
              className: "tabular-nums",
              render: (_, row) => percent(row.metrics.xirr),
            },
            {
              title: "最大回撤",
              width: 90,
              className: "tabular-nums",
              render: (_, row) => percent(row.metrics.maxDrawdown),
            },
            {
              title: "最长亏损时间",
              width: 105,
              className: "tabular-nums",
              render: (_, row) => `${longestDrawdownMonths(row)} 个月`,
            },
            {
              title: "累计分红",
              width: 104,
              className: "tabular-nums",
              render: (_, row) => money(row.metrics.totalDividend),
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
          <span>共 {rankedResults.length} 个标的</span>
          <Button
            icon={<DownloadOutlined />}
            disabled={!rankedResults.length}
            onClick={() => downloadComparison(rankedResults)}
          >
            导出对比结果
          </Button>
        </div>
      </section>

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
        width={1200}
        open={Boolean(detail)}
        footer={null}
        centered
        destroyOnHidden
        className="backtest-detail-modal"
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
                ["明细行数", `${simpleResult?.rows.length ?? 0} 条`],
                ["累计外部投入", money(simpleResult?.endingCost ?? 0)],
                ["累计买入金额", money(simpleResult?.endingInvestment ?? 0)],
                ["当前盈亏率", percent(simpleResult?.returnRate ?? null)],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong className="tabular-nums">{value}</strong>
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
                pagination={{
                  pageSize: 20,
                  showSizeChanger: false,
                  showQuickJumper: false,
                  hideOnSinglePage: false,
                  position: ["bottomRight"],
                }}
                dataSource={simpleResult.rows}
                scroll={{ x: 1400, y: 468 }}
                columns={[
                  {
                    title: "日期",
                    dataIndex: "date",
                    width: 108,
                    fixed: "left",
                    className: "tabular-nums",
                    sorter: (a, b) => a.date.localeCompare(b.date),
                    defaultSortOrder: "ascend",
                    filters: detailYears,
                    onFilter: (value, row) => row.date.startsWith(String(value)),
                  },
                  {
                    title: "事件",
                    dataIndex: "event",
                    width: 96,
                    fixed: "left",
                    render: (event: SimpleBacktestRow["event"]) => (
                      <Tag color={EVENT_COLORS[event]} bordered={false}>
                        {EVENT_LABELS[event]}
                      </Tag>
                    ),
                    filters: Object.entries(EVENT_LABELS).map(([value, label]) => ({
                      text: label,
                      value,
                    })),
                    onFilter: (value, row) => row.event === value,
                  },
                  {
                    title: "期初现金",
                    dataIndex: "openingCash",
                    width: 112,
                    align: "right",
                    className: "tabular-nums",
                    sorter: (a, b) => a.openingCash - b.openingCash,
                    render: (value: number) => money(value),
                  },
                  {
                    title: "收盘价",
                    dataIndex: "price",
                    width: 88,
                    align: "right",
                    className: "tabular-nums",
                    sorter: (a, b) => a.price - b.price,
                    render: (value: number) => value.toFixed(2),
                  },
                  {
                    title: "本次新增股数",
                    dataIndex: "shares",
                    width: 120,
                    align: "right",
                    className: "tabular-nums",
                    sorter: (a, b) => a.shares - b.shares,
                    render: (value: number, row) =>
                      row.event === "dividend" ? "—" : value.toFixed(2),
                  },
                  {
                    title: "累计股数",
                    dataIndex: "cumulativeShares",
                    width: 106,
                    align: "right",
                    className: "tabular-nums",
                    sorter: (a, b) => a.cumulativeShares - b.cumulativeShares,
                    render: (value: number) => value.toFixed(2),
                  },
                  {
                    title: "本期外部投入",
                    dataIndex: "externalContribution",
                    width: 120,
                    align: "right",
                    className: "tabular-nums",
                    sorter: (a, b) => a.externalContribution - b.externalContribution,
                    render: (value: number) => value > 0 ? money(value) : "—",
                  },
                  {
                    title: "发生金额",
                    width: 128,
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
                    title: "累计外部投入",
                    dataIndex: "cumulativeContribution",
                    width: 126,
                    align: "right",
                    className: "tabular-nums",
                    sorter: (a, b) =>
                      a.cumulativeContribution - b.cumulativeContribution,
                    render: (value: number) => money(value),
                  },
                  {
                    title: "累计买入金额",
                    dataIndex: "cumulativeInvestment",
                    width: 126,
                    align: "right",
                    className: "tabular-nums",
                    sorter: (a, b) =>
                      a.cumulativeInvestment - b.cumulativeInvestment,
                    render: (value: number) => money(value),
                  },
                  {
                    title: "期末现金",
                    dataIndex: "endingCash",
                    width: 110,
                    align: "right",
                    className: "tabular-nums",
                    sorter: (a, b) => a.endingCash - b.endingCash,
                    render: (value: number) => money(value),
                  },
                  {
                    title: "盈亏率",
                    dataIndex: "returnRate",
                    width: 94,
                    align: "right",
                    fixed: "right",
                    className: "tabular-nums",
                    sorter: (a, b) => a.returnRate - b.returnRate,
                    render: (value: number) => (
                      <Text type={value >= 0 ? "success" : "danger"}>
                        {percent(value)}
                      </Text>
                    ),
                  },
                ]}
              />
            )}

            <div className="detail-modal-footer">
              <div>
                <strong>口径</strong>
                <span>
                  交易费用 0 · 允许零碎股 · 现金分红全额回购 · 送股/转增按除权日入账
                </span>
              </div>
              <div className="detail-provenance">
                <CalendarOutlined />
                {detail.provenance.map((item) => (
                  <span key={`${item.source}-${item.dataCutoff}`}>
                    {item.source} · 截止 {item.dataCutoff}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
