import { useEffect, useMemo, useState } from "react";
import { Modal, Pagination, Select, Skeleton, Table, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { BACKTEST_DETAIL_PAGE_SIZE } from "../../../../shared/constants";
import {
  api,
  type BacktestResult,
  type SimpleBacktestRow,
} from "../../api/client";
import { formatYearRanges, money, percent, pnlClass } from "./formatters";

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

interface BacktestDetailModalProps {
  result: BacktestResult | null;
  onClose: () => void;
}

export function BacktestDetailModal({
  result,
  onClose,
}: BacktestDetailModalProps) {
  const [page, setPage] = useState(1);
  const [eventFilters, setEventFilters] = useState<
    SimpleBacktestRow["event"][]
  >([]);
  const detail = useQuery({
    queryKey: ["backtest:detail", result?.id],
    queryFn: () => api.getBacktestDetail(result!.id),
    enabled: Boolean(result),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const filteredRows = useMemo(() => {
    const rows = detail.data?.rows ?? [];
    if (!eventFilters.length) return rows;
    return rows.filter((row) => eventFilters.includes(row.event));
  }, [detail.data?.rows, eventFilters]);
  const pageRows = useMemo(
    () =>
      filteredRows.slice(
        (page - 1) * BACKTEST_DETAIL_PAGE_SIZE,
        page * BACKTEST_DETAIL_PAGE_SIZE,
      ),
    [filteredRows, page],
  );

  useEffect(() => {
    setPage(1);
    setEventFilters([]);
  }, [result?.id]);

  useEffect(() => {
    const finalPage = Math.max(
      1,
      Math.ceil(filteredRows.length / BACKTEST_DETAIL_PAGE_SIZE),
    );
    if (page > finalPage) setPage(finalPage);
  }, [filteredRows.length, page]);

  return (
    <Modal
      title={
        result ? (
          <div className="detail-modal-title">
            <span>{result.name}</span>
            <span className="tabular-nums">{result.symbol}</span>
            <i />
            <span>回测明细</span>
            {result.dataQuality?.level === "degraded" && (
              <Tag color="warning" bordered={false}>
                降级
              </Tag>
            )}
            {result.dataQuality?.reasons.includes(
              "calendar_coverage_missing",
            ) &&
              result.dataQuality.uncoveredCalendarYears.length > 0 && (
                <span className="detail-modal-degraded-years tabular-nums">
                  未覆盖年份：{formatYearRanges(
                    result.dataQuality.uncoveredCalendarYears,
                  )}
                </span>
              )}
          </div>
        ) : (
          "回测明细"
        )
      }
      width={1280}
      open={Boolean(result)}
      footer={null}
      style={{ top: 38 }}
      destroyOnHidden
      className="backtest-detail-modal"
      rootClassName="backtest-detail-root"
      onCancel={onClose}
    >
      {result && (
        <div className="detail-modal-body">
          <div className="detail-summary">
            {[
              [
                "实际区间",
                `${detail.data?.actualStartDate ?? result.actualStartDate} — ${
                  detail.data?.actualEndDate ?? result.actualEndDate
                }`,
              ],
              ["明细条数", `${detail.data?.rows.length ?? 0} 条`],
              ["累计外部投入", money(detail.data?.endingCost ?? 0), ""],
              [
                "累计分红（税后）",
                money(detail.data?.totalDividendAmount ?? 0),
                "",
              ],
              [
                "当前盈亏率",
                percent(detail.data?.returnRate ?? null),
                pnlClass(detail.data?.returnRate ?? null, "stock"),
              ],
            ].map(([label, value, tone]) => (
              <div key={label}>
                <span>{label}</span>
                <strong className={`tabular-nums ${tone}`}>{value}</strong>
              </div>
            ))}
          </div>

          {detail.isLoading && (
            <div className="detail-loading">
              <Skeleton active paragraph={{ rows: 8 }} />
            </div>
          )}
          {detail.isError && (
            <div className="detail-error">
              加载失败：
              {detail.error instanceof Error ? detail.error.message : "未知错误"}
            </div>
          )}
          {detail.data && (
            <Table
              size="small"
              rowKey={(row, index) => `${row.date}-${row.event}-${index ?? 0}`}
              pagination={false}
              onChange={(_, filters) => {
                setEventFilters(
                  (filters.event ?? []) as SimpleBacktestRow["event"][],
                );
                setPage(1);
              }}
              dataSource={pageRows}
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
                  filters: Object.entries(EVENT_LABELS).map(
                    ([value, label]) => ({
                      text: label,
                      value,
                    }),
                  ),
                  filteredValue: eventFilters.length ? eventFilters : null,
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
                  render: (value: number) => (value > 0 ? money(value) : "—"),
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
                    <span className={pnlClass(value, "stock")}>
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
              <span>
                {result.provenance
                  .map(
                    (item) =>
                      `${item.source}${item.fallbackUsed ? `（切换原因：${item.fallbackReason ?? "未知"}）` : ""} / ${item.adjustment === "qfq" ? "前复权" : "不复权"} / 截止 ${item.dataCutoff}`,
                  )
                  .join(" · ")}
              </span>
              <i />
              <strong>更新时间：</strong>
              <span className="tabular-nums">{result.actualEndDate}</span>
            </div>
            <div className="detail-pagination-controls">
              <span className="detail-total tabular-nums">
                共 {filteredRows.length} 条
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
                current={page}
                pageSize={BACKTEST_DETAIL_PAGE_SIZE}
                total={filteredRows.length}
                showSizeChanger={false}
                hideOnSinglePage={false}
                onChange={setPage}
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
