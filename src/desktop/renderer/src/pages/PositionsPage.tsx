import { useEffect, useMemo, useState } from "react";
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
  ReloadOutlined,
  SearchOutlined,
  StockOutlined,
  GiftOutlined,
  TransactionOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  api,
  type PerformancePeriod,
  type PositionView,
  type XirrStatus,
} from "../api/client";
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

const XIRR_STATUS_TEXT: Record<XirrStatus, string> = {
  ready: "按实际现金流日期年化",
  short_sample: "样本期不足 30 天，暂不展示",
  missing_valuation: "缺少正式期末估值，暂不可计算",
  insufficient_cashflows: "现金流数量或方向不足，暂不可计算",
  no_solution: "当前现金流无法求得有效 XIRR",
};

export function PositionsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<PositionSort>("marketValue");
  const [selectedSymbol, setSelectedSymbol] = useState<string>();
  const [detail, setDetail] = useState<PositionView | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const overview = useQuery({
    queryKey: ["positions:overview"],
    queryFn: api.getPositionsOverview,
  });
  const refresh = useMutation({
    mutationFn: api.refreshPositionsMarket,
    onSuccess: (result) => {
      queryClient.setQueryData(["positions:overview"], result.overview);
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      if (result.tailStatus !== "incomplete") {
        message.success("行情快照已刷新");
      } else {
        message.warning(
          `行情仅更新至 ${result.actualCutoff ?? "暂无可用日期"}`,
        );
      }
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
  // P-UI：搜索或筛选变化时返回第1页
  useEffect(() => {
    setCurrentPage(1);
  }, [assetFilter, keyword, sort]);
  // P-UI：选中证券被过滤掉时清除区间表现的单标的选择
  useEffect(() => {
    if (selectedSymbol && !rows.some((row) => row.symbol === selectedSymbol)) {
      setSelectedSymbol(undefined);
    }
  }, [rows, selectedSymbol]);
  // P2-2：翻页时清除选中证券，避免区间表现引用当前页不可见的标的
  useEffect(() => {
    setSelectedSymbol(undefined);
  }, [currentPage]);
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
      title: "持仓占比",
      dataIndex: "weight",
      width: 100,
      align: "right",
      render: (value: number | null) => (
        <span className="tabular-nums">{value === null ? "—" : percent(value)}</span>
      ),
    },
    {
      title: "当日盈亏",
      dataIndex: "dayPnl",
      width: 120,
      align: "right",
      render: (value: number | null) => (
        <span className={`tabular-nums ${pnlClass(value)}`}>{money(value, true)}</span>
      ),
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
        description="回答投入多少、当前价值多少以及投资赚了多少；全部结果按证券投资现金流统一重建。"
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
          {/* P-UI：指标分两行。第一行6项核心指标，第二行4项对账指标。 */}
          <LiveMetricStrip
            items={[
              { label: "持仓市值", value: money(overview.data.metrics.marketValue), helper: overview.data.valuationSource, icon: <StockOutlined />, tone: "blue" },
              { label: "累计净投入", value: money(overview.data.metrics.netInvestment), helper: "买入 − 卖出 − 外部分红", icon: <FundOutlined />, tone: "indigo" },
              { label: "投资总收益", value: money(overview.data.metrics.totalReturn, true), helper: "市值 + 卖出 + 分红 − 买入", icon: <ArrowUpOutlined />, tone: "red", valueClass: pnlClass(overview.data.metrics.totalReturn) },
              { label: "未实现收益", value: money(overview.data.metrics.unrealizedPnl, true), helper: "市值 − 剩余成本", icon: <StockOutlined />, tone: "blue", valueClass: pnlClass(overview.data.metrics.unrealizedPnl) },
              { label: "已实现收益", value: money(overview.data.metrics.realizedPnl, true), helper: "卖出 − 释放成本", icon: <TransactionOutlined />, tone: "green", valueClass: pnlClass(overview.data.metrics.realizedPnl) },
              { label: "XIRR", value: percent(overview.data.metrics.xirr, true), helper: XIRR_STATUS_TEXT[overview.data.metrics.xirrStatus], icon: <ArrowUpOutlined />, tone: "violet", valueClass: pnlClass(overview.data.metrics.xirr) },
            ]}
          />
          <LiveMetricStrip
            items={[
              { label: "累计买入", value: money(overview.data.metrics.cumulativeBuySpend), helper: "成交金额 + 买入费用", icon: <DollarCircleOutlined />, tone: "orange" },
              { label: "累计卖出", value: money(overview.data.metrics.cumulativeSellNetIncome), helper: "成交金额 − 卖出费用", icon: <TransactionOutlined />, tone: "green" },
              { label: "累计分红", value: money(overview.data.metrics.cumulativeDividend), helper: "现金分红到账", icon: <GiftOutlined />, tone: "orange" },
              { label: "待再投入", value: money(overview.data.metrics.pendingReinvestmentCash), helper: "组合内分红现金", icon: <GiftOutlined />, tone: "orange" },
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
                    <strong className={`tabular-nums ${pnlClass(value)}`}>
                      {value === null ? "数据不足" : percent(value, true)}
                    </strong>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="workspace-panel live-table-panel">
            <div className="live-table-toolbar">
              <div>
                <strong>当前持仓</strong>
                <span>共 {rows.length} 个标的</span>
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
              <LiveEmpty
                title="暂无实盘流水"
                description="先在交易流水页录入买入、卖出或分红事实，持仓将在保存后自动重建。"
                action={
                  <Button type="primary" onClick={() => navigate("/trades")}>
                    前往交易流水
                  </Button>
                }
              />
            ) : !overview.data.positions.length ? (
              <LiveEmpty
                title="当前无持仓"
                description="本地已有投资事实，但当前没有可展示的证券持仓；已清仓收益仍保留在累计指标中。"
                action={<Button onClick={() => navigate("/trades")}>查看交易流水</Button>}
              />
            ) : rows.length ? (
              <Table
                className="live-data-table"
                rowKey="symbol"
                columns={columns}
                dataSource={rows}
                scroll={{ x: 1280 }}
                pagination={{
                  current: currentPage,
                  pageSize,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 20, 50],
                  showTotal: (total) => `共 ${total} 个标的`,
                  position: ["bottomCenter"],
                  onChange: (page, size) => {
                    setCurrentPage(page);
                    setPageSize(size);
                  },
                  onShowSizeChange: (_page, size) => {
                    setPageSize(size);
                    setCurrentPage(1);
                  },
                }}
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
              <div><span>累计买入支出</span><strong>{money(detail.cumulativeBuySpend)}</strong></div>
              <div><span>累计卖出净收入</span><strong>{money(detail.cumulativeSellNetIncome)}</strong></div>
              <div><span>累计净投入</span><strong>{money(detail.netInvestment)}</strong></div>
              <div><span>待再投入分红</span><strong>{money(detail.pendingReinvestmentCash)}</strong></div>
              <div>
                <span>XIRR</span>
                <strong className={pnlClass(detail.xirr)}>
                  {percent(detail.xirr, true)}
                </strong>
                <small>{XIRR_STATUS_TEXT[detail.xirrStatus]}</small>
              </div>
            </div>
            <h3>区间表现</h3>
            <div className="drawer-performance">
              {(Object.keys(PERIOD_LABELS) as PerformancePeriod[]).map((period) => {
                const value = detail.periodPerformance[period];
                return (
                  <div key={period}>
                    <span>{PERIOD_LABELS[period]}</span>
                    <strong className={pnlClass(value)}>
                      {value === null ? "数据不足" : percent(value, true)}
                    </strong>
                  </div>
                );
              })}
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
