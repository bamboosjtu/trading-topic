import type { ReactNode } from "react";
import { Alert, Empty, Skeleton } from "antd";
import type { LiveDataQuality } from "../../api/client";
import {
  money,
  numberValue,
  percent,
  pnlClass,
} from "../_shared/format";

export { money, numberValue, percent, pnlClass };

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
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="live-empty">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
            {action ? <div className="live-empty-action">{action}</div> : null}
          </div>
        }
      />
    </div>
  );
}

interface LiveMetricItem {
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
