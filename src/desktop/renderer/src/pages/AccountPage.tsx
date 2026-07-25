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
  const metrics = [
    ["总资产", money(data.totalAsset)],
    ["持仓市值", money(data.marketValue)],
    ["可用现金", money(data.availableCash)],
    ["累计盈亏", money(data.totalPnl)],
    ["XIRR", data.xirr === null ? "不可计算" : `${(data.xirr * 100).toFixed(2)}%`],
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <Text className="text-xs tracking-[0.18em] uppercase !text-[#8a6a3e]">
            Local portfolio
          </Text>
          <Title level={2} className="!mt-1 !mb-1 !text-[26px]">
            资产账户
          </Title>
          <Text type="secondary">全部余额从有效流水重建，不维护可手工修改的持仓副本。</Text>
        </div>
        <Tag bordered={false}>
          {data.dataCutoff ? `估值截止 ${data.dataCutoff}` : "暂无估值行情"}
        </Tag>
      </div>
      <div className="workspace-panel">
        <div className="metric-strip grid grid-cols-5 py-6 px-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="px-6">
              <div className="metric-label">{label}</div>
              <div className="metric-value tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="workspace-panel overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-[#edf0f2]">
          <Text strong>当前持仓</Text>
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
            { title: "股票代码", dataIndex: "symbol" },
            { title: "持仓数量", dataIndex: "quantity" },
            { title: "平均成本", render: (_, row) => money(row.averageCost) },
            {
              title: "最新价格",
              render: (_, row) => (row.lastPrice ? money(row.lastPrice) : "—"),
            },
            { title: "持仓市值", render: (_, row) => money(row.marketValue) },
            {
              title: "持仓盈亏",
              render: (_, row) => (
                <Text type={row.pnl >= 0 ? "success" : "danger"}>{money(row.pnl)}</Text>
              ),
            },
          ]}
        />
      </div>
      <div className="text-xs text-[#7b8991]">
        总资产 = 持仓市值 + 可用现金 + 未到期逆回购资产（当前{" "}
        {money(data.reverseRepoAsset)}）
      </div>
    </div>
  );
}
