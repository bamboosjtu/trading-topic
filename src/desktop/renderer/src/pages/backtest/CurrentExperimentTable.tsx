import { Button, Table } from "antd";
import { TrophyFilled } from "@ant-design/icons";
import type { BacktestExperiment, BacktestResult } from "../../api/client";
import { money, percent } from "./formatters";

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

  return (
    <section className="workspace-panel comparison-panel">
      <div className="comparison-title">
        <div>
          <strong>本次实验结果（按 XIRR 排序）</strong>
          <span>只比较同一请求、同一数据截止时间下的标的结果</span>
        </div>
        {experiment ? (
          <small className="tabular-nums">
            运行于 {new Date(experiment.createdAt).toLocaleString("zh-CN")}
            {" · "}
            数据截止 {experiment.dataCutoff}
          </small>
        ) : null}
      </div>
      <Table
        className="comparison-table"
        rowKey="id"
        pagination={false}
        loading={loading}
        dataSource={rankedResults}
        locale={{ emptyText: "设置参数并开始回测后，将在这里展示标的对比" }}
        scroll={{ x: 1320 }}
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
