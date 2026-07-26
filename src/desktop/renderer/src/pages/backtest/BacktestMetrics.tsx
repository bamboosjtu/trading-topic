import {
  ClockCircleOutlined,
  DollarOutlined,
  FallOutlined,
  GiftOutlined,
  RiseOutlined,
  TrophyFilled,
} from "@ant-design/icons";
import type { BacktestResult } from "../../api/client";
import { money, percent } from "./formatters";

export function BacktestMetrics({ results }: { results: BacktestResult[] }) {
  const endingAsset = [...results].sort(
    (a, b) => b.metrics.endingAsset - a.metrics.endingAsset,
  )[0];
  const xirrWinner = [...results].sort(
    (a, b) =>
      (b.metrics.xirr ?? Number.NEGATIVE_INFINITY) -
      (a.metrics.xirr ?? Number.NEGATIVE_INFINITY),
  )[0];
  const deepestDrawdown = [...results].sort(
    (a, b) => a.metrics.maxDrawdown - b.metrics.maxDrawdown,
  )[0];
  const longestDrawdown = [...results].sort(
    (a, b) => b.metrics.maxDrawdownMonths - a.metrics.maxDrawdownMonths,
  )[0];
  const dividendWinner = [...results].sort(
    (a, b) => b.metrics.totalDividend - a.metrics.totalDividend,
  )[0];
  const metrics = [
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
      value: deepestDrawdown
        ? percent(deepestDrawdown.metrics.maxDrawdown)
        : "—",
      helper: deepestDrawdown?.name ?? "",
      icon: <FallOutlined />,
      tone: "teal",
    },
    {
      label: "最长亏损时间",
      value: longestDrawdown
        ? `${longestDrawdown.metrics.maxDrawdownMonths} 个月`
        : "—",
      helper:
        longestDrawdown?.metrics.maxDrawdownStart &&
        longestDrawdown.metrics.maxDrawdownEnd
          ? `${longestDrawdown.metrics.maxDrawdownStart.slice(0, 7)} → ${longestDrawdown.metrics.maxDrawdownEnd.slice(0, 7)}`
          : "",
      icon: <ClockCircleOutlined />,
      tone: "indigo",
    },
  ];
  return (
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
  );
}
