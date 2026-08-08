import { Button, Empty, Popconfirm, Skeleton, Table, Tag, Tooltip } from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import {
  BACKTEST_RANGE_LABELS,
  RECENT_BACKTEST_EXPERIMENT_LIMIT,
} from "../../../../shared/constants";
import type { BacktestExperimentSummary } from "../../api/client";
import { beijingTimestamp, formatYearRanges, money, percent, pnlClass } from "./formatters";

/**
 * 渲染历史实验的数据质量标签。
 *
 * - strict：不显示标签；
 * - research：灰色"研究口径"标签，鼠标悬停显示未覆盖年份说明；
 * - degraded：黄色"降级"标签。
 */
function HistoryDataQualityTag({
  level,
  uncoveredCalendarYears,
}: {
  level: "strict" | "research" | "degraded";
  uncoveredCalendarYears: number[];
}) {
  if (level === "strict") return null;
  if (level === "research") {
    const yearsText = formatYearRanges(uncoveredCalendarYears);
    const tooltip = yearsText
      ? `${yearsText} 未使用正式交易日历逐日复核。回测仅使用数据源返回的真实交易日期和价格，不进行插值或非交易日成交。`
      : "未使用正式交易日历逐日复核。回测仅使用数据源返回的真实交易日期和价格，不进行插值或非交易日成交。";
    return (
      <Tooltip title={tooltip}>
        <Tag color="default" bordered={false}>
          研究口径
        </Tag>
      </Tooltip>
    );
  }
  return (
    <Tag color="warning" bordered={false}>
      降级
    </Tag>
  );
}

interface ExperimentHistoryTableProps {
  experiments: BacktestExperimentSummary[];
  loading: boolean;
  deletingId?: string;
  onView: (experiment: BacktestExperimentSummary) => void;
  onCopy: (experiment: BacktestExperimentSummary) => void;
  onDelete: (experiment: BacktestExperimentSummary) => void;
}

function rangeLabel(experiment: BacktestExperimentSummary): string {
  const { request } = experiment;
  return request.rangeYears
    ? BACKTEST_RANGE_LABELS[request.rangeYears]
    : `${request.startDate} — ${request.endDate}`;
}

function createdAtLabel(createdAt: string): string {
  return beijingTimestamp(createdAt);
}

export function ExperimentHistoryTable({
  experiments,
  loading,
  deletingId,
  onView,
  onCopy,
  onDelete,
}: ExperimentHistoryTableProps) {
  if (loading && !experiments.length) {
    return (
      <section className="workspace-panel experiment-history-loading">
        <Skeleton active paragraph={{ rows: 7 }} />
      </section>
    );
  }

  return (
    <section className="workspace-panel experiment-history-panel">
      <div className="experiment-history-heading">
        <div>
          <h2>最近 {RECENT_BACKTEST_EXPERIMENT_LIMIT} 次回测试验</h2>
          <p>
            每次运行都会生成一份不可变快照；列表仅展示最近记录，数据库不会因此删除更早实验。
          </p>
        </div>
        <span className="experiment-count">
          当前返回 {experiments.length} 次
        </span>
      </div>
      <Table
        rowKey="experimentId"
        pagination={experiments.length > 12 ? { pageSize: 12 } : false}
        dataSource={experiments}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有保存的回测试验"
            />
          ),
        }}
        className="experiment-history-table"
        columns={[
          {
            title: "运行时间",
            dataIndex: "createdAt",
            width: 190,
            render: (value: string, row) => (
              <div className="history-created-cell">
                <strong className="tabular-nums">{createdAtLabel(value)}</strong>
                <HistoryDataQualityTag
                  level={row.dataQuality.level}
                  uncoveredCalendarYears={row.dataQuality.uncoveredCalendarYears}
                />
              </div>
            ),
          },
          {
            title: "回测区间",
            width: 200,
            render: (_, row) => (
              <div className="history-range-cell">
                <strong>{rangeLabel(row)}</strong>
                <span className="tabular-nums">
                  {row.request.startDate} — {row.request.endDate}
                </span>
              </div>
            ),
          },
          {
            title: "每月投入",
            width: 130,
            className: "tabular-nums",
            render: (_, row) => money(row.request.monthlyAmount),
          },
          {
            title: "标的数量",
            dataIndex: "resultCount",
            width: 105,
            align: "center",
            render: (value: number) => `${value} 支`,
          },
          {
            title: "最佳 XIRR",
            dataIndex: "bestXirr",
            width: 120,
            className: "tabular-nums",
            render: (value: number | null) => (
              <span className={pnlClass(value, "stock")}>
                {percent(value)}
              </span>
            ),
          },
          {
            title: "最大回撤",
            dataIndex: "maxDrawdown",
            width: 120,
            className: "tabular-nums",
            render: (value: number) => (
              <span className="stock-loss">{percent(value)}</span>
            ),
          },
          {
            title: "数据截止",
            dataIndex: "dataCutoff",
            width: 120,
            className: "tabular-nums",
          },
          {
            title: "操作",
            width: 310,
            fixed: "right",
            render: (_, row) => (
              <div className="history-actions">
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => onView(row)}
                >
                  查看结果
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => onCopy(row)}
                >
                  复制参数重新回测
                </Button>
                <Popconfirm
                  title="删除这次回测试验？"
                  description="实验结果和全部明细将一并删除，且无法恢复。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => onDelete(row)}
                >
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    loading={deletingId === row.experimentId}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
