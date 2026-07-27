import type { ReactNode } from "react";
import { Alert, Empty, Skeleton } from "antd";
import type { LiveDataQuality } from "../../api/client";

export function money(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}¥${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function numberValue(
  value: number | null,
  digits = 2,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function percent(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(2)}%`;
}

export function pnlClass(value: number | null): string {
  if (value === null || value === 0) return "finance-flat";
  return value > 0 ? "finance-profit" : "finance-loss";
}

export function QualityNotice({
  quality,
}: {
  quality?: LiveDataQuality;
}) {
  if (!quality || quality.status === "ready" || quality.status === "empty") {
    return null;
  }
  const stale = quality.status === "stale";
  return (
    <Alert
      showIcon
      type={stale ? "warning" : "info"}
      className="live-quality-alert"
      message={stale ? "行情快照已过期" : "当前数据不完整"}
      description={
        quality.issues.length
          ? quality.issues.join("；")
          : stale
            ? `本地行情截止 ${quality.dataCutoff ?? "未知"}，可刷新后再查看。`
            : "缺失值已显示为“—”，相关组合指标不会使用估算值补齐。"
      }
    />
  );
}

export function PageError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Alert
      showIcon
      type="error"
      className="live-page-error"
      message={title}
      description={error instanceof Error ? error.message : String(error)}
      action={
        <button type="button" className="inline-link" onClick={onRetry}>
          重试
        </button>
      }
    />
  );
}

export function LiveLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="live-loading" aria-busy="true">
      <Skeleton active paragraph={{ rows }} />
    </div>
  );
}

export function LiveEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="live-empty">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
        }
      />
    </div>
  );
}

export interface LiveMetricItem {
  label: string;
  value: string;
  helper?: string;
  icon: ReactNode;
  tone: "blue" | "orange" | "red" | "green" | "indigo" | "violet";
  valueClass?: string;
}

export function LiveMetricStrip({
  items,
}: {
  items: LiveMetricItem[];
}) {
  return (
    <section
      className="workspace-panel live-metric-strip"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div className="live-metric" key={item.label}>
          <span className={`live-metric-icon ${item.tone}`}>{item.icon}</span>
          <div className="min-w-0">
            <div className="live-metric-label">{item.label}</div>
            <div
              className={`live-metric-value tabular-nums ${item.valueClass ?? ""}`}
            >
              {item.value}
            </div>
            <div className="live-metric-helper">{item.helper ?? "\u00a0"}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

export function LivePageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading live-page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="live-page-actions">{actions}</div> : null}
    </header>
  );
}
