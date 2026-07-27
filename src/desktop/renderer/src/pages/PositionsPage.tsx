import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Input,
  Select,
  Segmented,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowUpOutlined,
  DownloadOutlined,
  DollarCircleOutlined,
  EyeOutlined,
  FundOutlined,
  PieChartOutlined,
  ReloadOutlined,
  SearchOutlined,
  StockOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type PerformancePeriod, type PositionView } from "../api/client";
import {
  LiveEmpty,
  LiveLoading,
  LiveMetricStrip,
  LivePageHeader,
  PageError,
  QualityNotice,
  money,
  numberValue,
  percent,
  pnlClass,
} from "./live/liveFormat";

const PERIOD_LABELS: Record<PerformancePeriod, string> = {
  day: "当日",
  week: "近一周",
  month: "近一月",
  threeMonths: "近三月",
  sixMonths: "近六月",
  year: "近一年",
};

type AssetFilter = "all" | "stock" | "etf";
type PositionSort = "marketValue" | "totalReturn" | "symbol";

export function PositionsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<PositionSort>("marketValue");
  const [selectedSymbol, setSelectedSymbol] = useState<string>();
  const [detail, setDetail] = useState<PositionView | null>(null);
  const overview = useQuery({
    queryKey: ["positions:overview"],
    queryFn: api.getPositionsOverview,
  });
  const refresh = useMutation({
    mutationFn: api.refreshPositionsMarket,
    onSuccess: (data) => {
      queryClient.setQueryData(["positions:overview"], data);
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      message.success("行情快照已刷新");
    },
    onError: (error) => message.error(error.message),
  });
  const exportData = useMutation({
    mutationFn: api.exportPositions,
    onSuccess: (result) => {
      if (!result.cancelled) message.success("持仓明细已导出");
    },
    onError: (error) => message.error(error.message),
  });
  const rows = useMemo(() => {
    const search = keyword.trim().toLocaleLowerCase("zh-CN");
    return [...(overview.data?.positions ?? [])]
      .filter(
        (row) =>
          (assetFilter === "all" || row.securityType === assetFilter) &&
          (!search ||
            `${row.name} ${row.symbol}`
              .toLocaleLowerCase("zh-CN")
              .includes(search)),
      )
      .sort((left, right) => {
        if (sort === "symbol") return left.symbol.localeCompare(right.symbol);
        return (right[sort] ?? Number.NEGATIVE_INFINITY) -
          (left[sort] ?? Number.NEGATIVE_INFINITY);
      });
  }, [assetFilter, keyword, overview.data?.positions, sort]);
  const selected =
    overview.data?.positions.find((row) => row.symbol === selectedSymbol) ??
    null;

  const columns: ColumnsType<PositionView> = [
    {
      title: "标的",
      key: "symbol",
      width: 210,
      render: (_, row) => (
        <div className="live-symbol-cell">
          <span className="live-symbol-avatar">{row.name.slice(0, 1)}</span>
          <div>
            <strong>{row.name}</strong>
            <span>{row.symbol} · {row.securityType === "stock" ? "股票" : "ETF"}</span>
          </div>
        </div>
      ),
    },
    {
      title: "持仓数量",
      dataIndex: "quantity",
      width: 120,
      align: "right",
      render: (value: number) => <span className="tabular-nums">{numberValue(value)}</span>,
    },
    {
      title: "成本价",
      dataIndex: "averageCost",
      width: 110,
      align: "right",
      render: (value: number) => <span className="tabular-nums">{numberValue(value, 3)}</span>,
    },
    {
      title: "最新价",
      dataIndex: "lastPrice",
      width: 110,
      align: "right",
      render: (value: number | null) => <span className="tabular-nums">{numberValue(value, 3)}</span>,
    },
    {
      title: "持仓市值",
      dataIndex: "marketValue",
      width: 140,
      align: "right",
      render: (value: number | null) => <strong className="tabular-nums">{money(value)}</strong>,
    },
    {
      title: "累计投入",
      dataIndex: "cumulativeInvestment",
      width: 140,
      align: "right",
      render: (value: number) => <span className="tabular-nums">{money(value)}</span>,
    },
    {
      title: "浮动盈亏",
      dataIndex: "unrealizedPnl",
      width: 130,
      align: "right",
      render: (value: number | null) => (
        <span className={`tabular-nums ${pnlClass(value)}`}>{money(value, true)}</span>
      ),
    },
    {
      title: "累计分红",
      dataIndex: "cumulativeDividend",
      width: 130,
      align: "right",
      render: (value: number) => <span className="tabular-nums">{money(value)}</span>,
    },
    {
      title: "总收益",
      dataIndex: "totalReturn",
      width: 130,
      align: "right",
      render: (value: number | null) => (
        <span className={`tabular-nums ${pnlClass(value)}`}>{money(value, true)}</span>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 100,
      align: "center",
      render: (_, row) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetail(row)}>
          查看
        </Button>
      ),
    },
  ];

  return (
    <div className="live-page positions-page">
      <LivePageHeader
        title="持仓明细"
        description="查看当前持仓、成本与本地行情估值；所有数据均来自本机流水。"
        actions={
          <>
            <span className="live-cutoff">
              行情更新：{overview.data?.quality.dataCutoff ?? "暂无快照"}
            </span>
            <Button
              icon={<ReloadOutlined />}
              loading={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              刷新行情
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              disabled={!overview.data?.positions.length}
              loading={exportData.isPending}
              onClick={() => exportData.mutate()}
            >
              导出持仓
            </Button>
          </>
        }
      />
      {overview.isLoading ? (
        <section className="workspace-panel"><LiveLoading rows={13} /></section>
      ) : overview.isError ? (
        <PageError title="持仓数据加载失败" error={overview.error} onRetry={() => void overview.refetch()} />
      ) : overview.data ? (
        <>
          <QualityNotice quality={overview.data.quality} />
          <LiveMetricStrip
            items={[
              { label: "总资产", value: money(overview.data.metrics.totalAsset), helper: "现金 + 持仓市值", icon: <DollarCircleOutlined />, tone: "blue" },
              { label: "持仓市值", value: money(overview.data.metrics.marketValue), helper: overview.data.valuationSource, icon: <StockOutlined />, tone: "orange" },
              { label: "累计收益", value: money(overview.data.metrics.totalPnl, true), helper: "含已实现、浮动与分红", icon: <ArrowUpOutlined />, tone: "red", valueClass: pnlClass(overview.data.metrics.totalPnl) },
              { label: "累计收益率", value: percent(overview.data.metrics.totalReturnRate, true), helper: "基于累计资金转入", icon: <FundOutlined />, tone: "green", valueClass: pnlClass(overview.data.metrics.totalReturnRate) },
              { label: "可用现金", value: overview.data.quality.status === "empty" ? "—" : money(overview.data.metrics.availableCash), helper: "不含未到期逆回购", icon: <WalletOutlined />, tone: "indigo" },
              { label: "仓位比例", value: percent(overview.data.metrics.positionRatio), helper: "持仓市值 / 总资产", icon: <PieChartOutlined />, tone: "violet" },
            ]}
          />
          <section className="workspace-panel live-performance-panel">
            <div className="live-panel-title">
              <div>
                <strong>区间表现</strong>
                <span>{selected ? `${selected.name} ${selected.symbol}` : "组合表现"}</span>
              </div>
              {selected ? (
                <Button type="link" size="small" onClick={() => setSelectedSymbol(undefined)}>返回组合</Button>
              ) : null}
            </div>
            <div className="performance-grid">
              {(Object.keys(PERIOD_LABELS) as PerformancePeriod[]).map((period) => {
                const value = selected
                  ? selected.periodPerformance[period]
                  : overview.data.portfolioPerformance[period];
                return (
                  <div key={period}>
                    <span>{PERIOD_LABELS[period]}</span>
                    <strong className={`tabular-nums ${pnlClass(value)}`}>{percent(value, true)}</strong>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="workspace-panel live-table-panel">
            <div className="live-table-toolbar">
              <div>
                <strong>当前持仓</strong>
                <span>共 {overview.data.positions.length} 个标的</span>
              </div>
              <div className="live-filter-row">
                <Segmented
                  value={assetFilter}
                  options={[
                    { label: "全部", value: "all" },
                    { label: "股票", value: "stock" },
                    { label: "ETF", value: "etf" },
                  ]}
                  onChange={(value) => setAssetFilter(value as AssetFilter)}
                />
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索名称或代码"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <Select
                  value={sort}
                  options={[
                    { label: "按市值排序", value: "marketValue" },
                    { label: "按总收益排序", value: "totalReturn" },
                    { label: "按代码排序", value: "symbol" },
                  ]}
                  onChange={setSort}
                />
              </div>
            </div>
            {!overview.data.hasLedgerEntries ? (
              <LiveEmpty title="暂无实盘流水" description="本页面只展示本地已存在的实盘记录，不提供录入或导入入口。" />
            ) : !overview.data.positions.length ? (
              <LiveEmpty title="当前无持仓" description="本地已有资金记录，但当前没有可展示的证券持仓。" />
            ) : rows.length ? (
              <Table
                className="live-data-table"
                rowKey="symbol"
                columns={columns}
                dataSource={rows}
                pagination={rows.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
                rowClassName={(row) => row.symbol === selectedSymbol ? "live-selected-row" : ""}
                onRow={(row) => ({ onClick: () => setSelectedSymbol(row.symbol) })}
              />
            ) : (
              <LiveEmpty title="没有匹配的持仓" description="请调整资产类型或搜索条件。" />
            )}
          </section>
          {overview.data.quality.status === "partial" ? (
            <Alert
              showIcon
              type="info"
              className="live-footer-notice"
              message="缺失行情的标的不会使用成本价冒充市值；受影响指标显示为“—”。"
            />
          ) : null}
        </>
      ) : null}
      <Drawer
        title={detail ? `${detail.name} ${detail.symbol}` : "持仓详情"}
        width={600}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="position-drawer">
            <div className="drawer-fact-grid">
              <div><span>资产类型</span><strong>{detail.securityType === "stock" ? "股票" : "ETF"}</strong></div>
              <div><span>持仓数量</span><strong>{numberValue(detail.quantity)}</strong></div>
              <div><span>持仓成本</span><strong>{money(detail.cost)}</strong></div>
              <div><span>最新市值</span><strong>{money(detail.marketValue)}</strong></div>
              <div><span>累计分红</span><strong>{money(detail.cumulativeDividend)}</strong></div>
              <div><span>总收益</span><strong className={pnlClass(detail.totalReturn)}>{money(detail.totalReturn, true)}</strong></div>
            </div>
            <h3>区间表现</h3>
            <div className="drawer-performance">
              {(Object.keys(PERIOD_LABELS) as PerformancePeriod[]).map((period) => (
                <div key={period}>
                  <span>{PERIOD_LABELS[period]}</span>
                  <strong className={pnlClass(detail.periodPerformance[period])}>
                    {percent(detail.periodPerformance[period], true)}
                  </strong>
                </div>
              ))}
            </div>
            <div className="drawer-section-heading">
              <h3>最近流水</h3>
              <Button
                type="link"
                size="small"
                onClick={() => navigate(`/trades?symbol=${detail.symbol}`)}
              >
                查看全部
              </Button>
            </div>
            {detail.recentEntries.length ? (
              <div className="recent-ledger-list">
                {detail.recentEntries.map((entry) => (
                  <div key={entry.id}>
                    <span>{entry.businessDate}</span>
                    <Tag>{entry.type}</Tag>
                    <strong>{money(entry.amount)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <LiveEmpty title="暂无关联流水" description="该标的没有可展示的历史记录。" />
            )}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
