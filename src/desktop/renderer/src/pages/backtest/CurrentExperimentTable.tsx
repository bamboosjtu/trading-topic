import { Alert, Button, Table, Tag } from "antd";
import { TrophyFilled } from "@ant-design/icons";
import type { BacktestExperiment, BacktestResult } from "../../api/client";
import { beijingTimestamp, formatYearRanges, money, percent, pnlClass } from "./formatters";

interface CurrentExperimentTableProps {
  experiment: BacktestExperiment | undefined;
  results: BacktestResult[];
  loading: boolean;
  onDetail: (result: BacktestResult) => void;
}

export function CurrentExperimentTable({
  experiment,
  results,
  loading,
  onDetail,
}: CurrentExperimentTableProps) {
  const rankedResults = [...results].sort(
    (left, right) =>
      (right.metrics.xirr ?? Number.NEGATIVE_INFINITY) -
      (left.metrics.xirr ?? Number.NEGATIVE_INFINITY),
  );
  const comparisonWarning = results
    .flatMap((result) => result.warnings)
    .find((warning) => warning.includes("非严格同区间比较"));
  const corporateActionWarnings = [
    ...new Set(
      results.flatMap((result) =>
        result.warnings
          .filter((warning) => warning.startsWith("配股事件"))
          .map((warning) => `${result.name}（${result.symbol}）：${warning}`),
      ),
    ),
  ];
  const experimentReasons = experiment?.dataQuality?.reasons ?? [];
  const calendarCoverageMissing =
    experimentReasons.includes("calendar_coverage_missing");
  const uncoveredCalendarYearsText = experiment?.dataQuality
    ? formatYearRanges(experiment.dataQuality.uncoveredCalendarYears)
    : "";
  const commonGapResults = results.filter((result) =>
    (result.dataQuality?.reasons ?? []).includes("cross_provider_common_gap"),
  );

  return (
    <section className="workspace-panel comparison-panel">
      <div className="comparison-title">
        <div>
          <strong>本次实验结果（按 XIRR 排序）</strong>
          <span>只比较同一请求、同一数据截止时间下的标的结果</span>
        </div>
        {experiment ? (
          <small className="tabular-nums">
            运行于 {beijingTimestamp(experiment.createdAt)}
            {" · "}
            数据截止 {experiment.dataCutoff}
          </small>
        ) : null}
      </div>
      {calendarCoverageMissing ? (
        <Alert
          className="comparison-warning"
          showIcon
          type="warning"
          message="本次回测包含尚未由正式交易日历逐日验证的年份"
          description={`本次回测包含尚未由正式交易日历逐日验证的年份：${uncoveredCalendarYearsText}。回测仍可计算，但无法证明这些年份不存在两源共同缺失，因此结果属于降级证据。`}
        />
      ) : null}
      {commonGapResults.length ? (
        <Alert
          className="comparison-warning"
          showIcon
          type="warning"
          message="本次回测使用了降级行情证据"
          description={
            <div>
              {commonGapResults.map((result) => (
                <div key={result.symbol}>
                  <strong>{result.symbol}</strong>
                  ：存在两源共同缺口且未取得独立停牌证据，
                  期间未生成交易价格，定投顺延至下一真实交易日。
                </div>
              ))}
            </div>
          }
        />
      ) : null}
      {comparisonWarning ? (
        <Alert
          className="comparison-warning"
          showIcon
          type="warning"
          message="实际起始日期不一致"
          description={comparisonWarning}
        />
      ) : null}
      {corporateActionWarnings.length ? (
        <Alert
          className="comparison-warning"
          showIcon
          type="warning"
          message="已报告但不参与的公司行动"
          description={
            <ul>
              {corporateActionWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      <Table
        className="comparison-table"
        rowKey="id"
        pagination={false}
        loading={loading}
        dataSource={rankedResults}
        locale={{ emptyText: "设置参数并开始回测后，将在这里展示标的对比" }}
        scroll={{ x: 1488 }}
        onRow={(record) => ({
          onDoubleClick: () => onDetail(record),
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
            width: 160,
            render: (_, row) => (
              <div className="symbol-cell">
                <strong>{row.name}</strong>
                <span className="tabular-nums">{row.symbol}</span>
                {row.dataQuality?.level === "degraded" && (
                  <Tag color="warning" className="degraded-tag">
                    降级
                  </Tag>
                )}
              </div>
            ),
          },
          {
            title: "实际区间",
            width: 176,
            className: "tabular-nums",
            render: (_, row) => (
              <span>
                {row.actualStartDate} → {row.actualEndDate}
              </span>
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
              <span className={pnlClass(row.metrics.xirr, "stock")}>
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
              <span className="stock-loss">
                {percent(row.metrics.maxDrawdown)}
              </span>
            ),
          },
          {
            title: "最长亏损时间",
            width: 128,
            className: "tabular-nums",
            render: (_, row) => (
              <div className="drawdown-period">
                <span>{row.metrics.longestDrawdownMonths} 个月</span>
                {row.metrics.longestDrawdownStart &&
                  row.metrics.longestDrawdownEnd && (
                    <small>
                      {row.metrics.longestDrawdownStart.slice(0, 7)} →{" "}
                      {row.metrics.longestDrawdownEnd.slice(0, 7)}
                      {row.metrics.longestDrawdownRecovered
                        ? ""
                        : "（未恢复）"}
                    </small>
                  )}
              </div>
            ),
          },
          {
            title: "期末现金",
            width: 80,
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
                onClick={() => onDetail(row)}
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
  );
}
