import { Skeleton, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

const { Title, Text } = Typography;
const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(value);

export function AccountPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["account"],
    queryFn: api.accountSummary,
  });
  if (isLoading || !data) return <Skeleton active />;
  const metrics: Array<[string, string, "up" | "down" | null]> = [
    ["总资产", money(data.totalAsset), null],
    ["持仓市值", money(data.marketValue), null],
    ["可用现金", money(data.availableCash), null],
    ["累计盈亏", money(data.totalPnl), data.totalPnl >= 0 ? "up" : "down"],
    ["XIRR", data.xirr === null ? "不可计算" : `${(data.xirr * 100).toFixed(2)}%`, null],
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="page-eyebrow">Local Portfolio</div>
          <Title level={2} className="!mt-1.5 !mb-1.5 !text-[24px] tracking-tight">
            资产账户
          </Title>
          <Text type="secondary" className="text-[13px]">
            全部余额从有效流水重建，不维护可手工修改的持仓副本。
          </Text>
        </div>
        <Tag bordered={false} color="gold" className="!mr-0">
          {data.dataCutoff ? `估值截止 ${data.dataCutoff}` : "暂无估值行情"}
        </Tag>
      </div>
      <div className="workspace-panel">
        <div className="metric-strip grid grid-cols-5 py-7 px-2">
          {metrics.map(([label, value, tone]) => (
            <div key={label} className="px-6">
              <div className="metric-label">{label}</div>
              <div
                className={`metric-value tabular-nums ${
                  tone === "up"
                    ? "!text-[#2e7d4f]"
                    : tone === "down"
                      ? "!text-[#d4382c]"
                      : ""
                }`}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="workspace-panel overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-line-soft">
          <Text strong className="text-[15px]">当前持仓</Text>
          <Text type="secondary" className="text-xs">
            {data.valuationSource}
          </Text>
        </div>
        <Table
          rowKey="symbol"
          pagination={false}
          locale={{ emptyText: "暂无有效买入流水" }}
          dataSource={data.positions}
          columns={[
            {
              title: "股票代码",
              dataIndex: "symbol",
              className: "tabular-nums",
            },
            {
              title: "持仓数量",
              dataIndex: "quantity",
              align: "right",
              className: "tabular-nums",
            },
            {
              title: "平均成本",
              align: "right",
              className: "tabular-nums",
              render: (_, row) => money(row.averageCost),
            },
            {
              title: "最新价格",
              align: "right",
              className: "tabular-nums",
              render: (_, row) => (row.lastPrice ? money(row.lastPrice) : "—"),
            },
            {
              title: "持仓市值",
              align: "right",
              className: "tabular-nums",
              render: (_, row) => money(row.marketValue),
            },
            {
              title: "持仓盈亏",
              align: "right",
              render: (_, row) => (
                <Text
                  type={row.pnl >= 0 ? "success" : "danger"}
                  className="tabular-nums"
                >
                  {money(row.pnl)}
                </Text>
              ),
            },
          ]}
        />
      </div>
      <div className="px-1 text-xs text-ink-400">
        总资产 = 持仓市值 + 可用现金 + 未到期逆回购资产（当前{" "}
        {money(data.reverseRepoAsset)}）
      </div>
    </div>
  );
}
