import { Alert, Button, Table, Tag, Tooltip } from "antd";
import { TrophyFilled } from "@ant-design/icons";
import type { BacktestExperiment, BacktestResult } from "../../api/client";
import { beijingTimestamp, formatYearRanges, money, percent, pnlClass } from "./formatters";

interface CurrentExperimentTableProps {
  experiment: BacktestExperiment | undefined;
  results: BacktestResult[];
  loading: boolean;
  onDetail: (result: BacktestResult) => void;
}

/**
 * 渲染数据质量等级标签。
 *
 * - strict：不显示标签（默认状态）；
 * - research：灰色"研究口径"标签，鼠标悬停显示未覆盖年份说明；
 * - degraded：黄色"降级"标签。
 */
function DataQualityTag({
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
        <Tag color="default" bordered={false} className="research-tag">
          研究口径
        </Tag>
      </Tooltip>
    );
  }
  return (
    <Tag color="warning" bordered={false} className="degraded-tag">
      降级
    </Tag>
  );
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
  const uncoveredCalendarYearsText = experiment?.dataQuality
    ? formatYearRanges(experiment.dataQuality.uncoveredCalendarYears)
    : "";
  // 仅在 degraded 级别（cross_provider_common_gap）显示黄色大警告
  const isExperimentDegraded = experiment?.dataQuality.level === "degraded";
  const commonGapResults = results.filter((result) =>
    result.dataQuality.reasons.includes("cross_provider_common_gap"),
  );

  return (
    <section className="workspace-panel comparison-panel">
      <div className="comparison-title">
        <div>
          <strong>本次实验结果（按 XIRR 排序）</strong>
          <span>只比较同一请求、同一数据截止时间下的标的结果</span>
          {experiment?.dataQuality.level === "research" && (
            <Tooltip
              title={
                uncoveredCalendarYearsText
                  ? `${uncoveredCalendarYearsText} 未使用正式交易日历逐日复核。回测仅使用数据源返回的真实交易日期和价格，不进行插值或非交易日成交。`
                  : "未使用正式交易日历逐日复核。回测仅使用数据源返回的真实交易日期和价格，不进行插值或非交易日成交。"
              }
            >
              <Tag color="default" bordered={false} className="research-tag">
                研究口径
              </Tag>
            </Tooltip>
          )}
        </div>
        {experiment ? (
          <small className="tabular-nums">
            运行于 {beijingTimestamp(experiment.createdAt)}
            {" · "}
            数据截止 {experiment.dataCutoff}
          </small>
        ) : null}
      </div>
      {/* 仅 degraded 级别（两源共同缺口）显示黄色大警告；
          research 级别（仅日历覆盖不完整）不显示 Alert，避免过度打扰 */}
      {isExperimentDegraded && commonGapResults.length ? (
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
            width: 180,
            render: (_, row) => (
              <div className="symbol-cell">
                <strong>{row.name}</strong>
                <span className="tabular-nums">{row.symbol}</span>
                <DataQualityTag
                  level={row.dataQuality.level}
                  uncoveredCalendarYears={row.dataQuality.uncoveredCalendarYears}
                />
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
