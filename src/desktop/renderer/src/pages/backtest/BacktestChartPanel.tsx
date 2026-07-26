import { DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Skeleton, Tooltip } from "antd";
import ReactECharts from "echarts-for-react";
import type {
  BacktestCandlePeriod,
  BacktestChartMetric,
  BacktestResult,
  ChartDataState,
} from "../../api/client";
import {
  buildKlineOption,
  buildPerformanceOption,
} from "./marketChartModel";

interface BacktestChartPanelProps {
  results: BacktestResult[];
  chartMetric: BacktestChartMetric;
  candlePeriod: BacktestCandlePeriod;
  chartSymbol: string;
  marketBars: ChartDataState;
  exporting: boolean;
  canExport: boolean;
  onMetricChange: (metric: BacktestChartMetric) => void;
  onPeriodChange: (period: BacktestCandlePeriod) => void;
  onSymbolChange: (symbol: string) => void;
  onExport: () => void;
}

export function BacktestChartPanel({
  results,
  chartMetric,
  candlePeriod,
  chartSymbol,
  marketBars,
  exporting,
  canExport,
  onMetricChange,
  onPeriodChange,
  onSymbolChange,
  onExport,
}: BacktestChartPanelProps) {
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
  const option =
    chartMetric === "kline"
      ? marketBars.status === "ready"
        ? buildKlineOption(marketBars.data, candlePeriod)
        : null
      : buildPerformanceOption(results, chartMetric);
  return (
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
              onClick={() => onMetricChange(key)}
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
                  onClick={() => onPeriodChange(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <Tooltip title="导出对比结果">
            <Button
              icon={<DownloadOutlined />}
              loading={exporting}
              disabled={!canExport}
              onClick={onExport}
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
                checked={chartSymbol === result.symbol}
                onChange={() => onSymbolChange(result.symbol)}
              />
              <span>{result.name}</span>
            </label>
          ))}
        </div>
      )}
      {chartMetric === "kline" && marketBars.status === "loading" ? (
        <div className="chart-loading">
          <Skeleton active paragraph={{ rows: 5 }} title={false} />
        </div>
      ) : chartMetric === "kline" && marketBars.status === "error" ? (
        <Alert type="error" showIcon message={marketBars.message} />
      ) : chartMetric === "kline" && marketBars.status === "unavailable" ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={marketBars.reason}
          className="chart-empty"
        />
      ) : !results.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="设置参数并开始回测后，将在这里展示行情与收益曲线"
          className="chart-empty"
        />
      ) : (
        <ReactECharts
          notMerge
          option={option}
          className="backtest-chart"
          style={{ height: chartMetric === "kline" ? 270 : 300 }}
        />
      )}
    </section>
  );
}
