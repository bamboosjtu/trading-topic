import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import {
  CalendarOutlined,
  DownloadOutlined,
  EyeOutlined,
  GiftOutlined,
  PlusOutlined,
  SearchOutlined,
  SwapOutlined,
  TransactionOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useSearchParams } from "react-router-dom";
import {
  api,
  type ConfirmPendingDividendInput,
  type EntryType,
  type LedgerQuery,
  type LedgerRecordView,
  type PendingDividend,
  type SecurityType,
} from "../api/client";
import { LIVE_LEDGER_PAGE_SIZES } from "../../../shared/constants";
import {
  ENTRY_TYPE_LABELS,
  ENTRY_TYPE_OPTIONS,
  ENTRY_TYPE_TONES,
} from "./live/liveConstants";
import {
  LiveEmpty,
  LiveLoading,
  LiveMetricStrip,
  LivePageHeader,
  PageError,
  QualityNotice,
  money,
  numberValue,
} from "./live/liveFormat";
import { LedgerEntryModal } from "./live/LedgerEntryModal";
import { DividendReinvestmentModal } from "./live/DividendReinvestmentModal";
import { beijingDate, beijingTimestamp } from "./_shared/format";

const { RangePicker } = DatePicker;
type LedgerPageSize = (typeof LIVE_LEDGER_PAGE_SIZES)[number];

// 现金流方向（买入支出/卖出收入/分红到账）不使用红涨绿跌配色，
// 避免 A 股语境下"绿色=亏损"的误解；统一用深色正文 + 正负号表达方向。
function signedAmount(row: LedgerRecordView): string {
  const value = row.amount;
  if (value === null) return "—";
  if (["sell", "dividend"].includes(row.type)) return money(value, true);
  if (row.type === "buy") return money(-value);
  return money(value);
}

// 待确认分红每股面值展示：保持 3 位小数，避免 0.18 元/股被截断为 0.2。
function perShareLabel(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `¥${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })}`;
}

interface ConfirmState {
  candidate: PendingDividend;
  actualAmount: number;
  // 当候选未公告到账日时，由用户填写实际到账日；否则使用 candidate.paymentDate
  actualPaymentDate: Dayjs | null;
  reinvest: boolean;
  reinvestmentDate: Dayjs | null;
  buyPrice: number | null;
  buyQuantity: number | null;
  fee: number;
}

export function TradesPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const linkedDate = searchParams.get("date");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(
    linkedDate ? [dayjs(linkedDate), dayjs(linkedDate)] : null,
  );
  const [entryTypes, setEntryTypes] = useState<EntryType[]>([]);
  const [securityType, setSecurityType] = useState<SecurityType>();
  const [symbol, setSymbol] = useState(searchParams.get("symbol") ?? undefined);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<LedgerPageSize>(20);
  const [detail, setDetail] = useState<LedgerRecordView | null>(null);
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [reinvestmentOpen, setReinvestmentOpen] = useState(false);
  const [correctionTarget, setCorrectionTarget] =
    useState<LedgerRecordView | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const query: LedgerQuery = useMemo(
    () => ({
      startDate: dateRange?.[0].format("YYYY-MM-DD"),
      endDate: dateRange?.[1].format("YYYY-MM-DD"),
      entryTypes: entryTypes.length ? entryTypes : undefined,
      securityType,
      symbol,
      keyword: keyword.trim() || undefined,
      page,
      pageSize,
    }),
    [dateRange, entryTypes, keyword, page, pageSize, securityType, symbol],
  );
  const ledger = useQuery({
    queryKey: ["ledger:query", query],
    queryFn: () => api.queryLedger(query),
  });
  const stockCatalog = useQuery({
    queryKey: ["instruments", "stock"],
    queryFn: api.listAStocks,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const etfCatalog = useQuery({
    queryKey: ["instruments", "etf"],
    queryFn: api.listEtfs,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const instruments = useMemo(
    () => [...(stockCatalog.data ?? []), ...(etfCatalog.data ?? [])],
    [etfCatalog.data, stockCatalog.data],
  );
  const catalogStatus = {
    stock: {
      loading: stockCatalog.isLoading,
      error: stockCatalog.error?.message,
    },
    etf: {
      loading: etfCatalog.isLoading,
      error: etfCatalog.error?.message,
    },
  };
  // 待确认分红：后端 listPendingDividends 返回全部状态记录，前端按 status=pending 过滤。
  const pendingDividendsQuery = useQuery({
    queryKey: ["pending-dividends"],
    queryFn: () => api.listPendingDividends(),
  });
  const pendingCandidates = useMemo(
    () =>
      (pendingDividendsQuery.data ?? []).filter(
        (item) => item.status === "pending",
      ),
    [pendingDividendsQuery.data],
  );
  const exportData = useMutation({
    mutationFn: () => api.exportLedger(query),
    onSuccess: (result) => {
      if (!result.cancelled) message.success("交易流水已导出");
    },
    onError: (error) => message.error(error.message),
  });
  const resetPage = () => setPage(1);
  const refreshLivePages = () => {
    void queryClient.invalidateQueries({ queryKey: ["ledger:query"] });
    void queryClient.invalidateQueries({ queryKey: ["positions:overview"] });
    void queryClient.invalidateQueries({ queryKey: ["income-calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["health"] });
  };
  const discoverMutation = useMutation({
    mutationFn: () => api.discoverPendingDividends(),
    onSuccess: (result) => {
      // P2：完整披露已检查/失败/新增，避免"全部静默失败 → 发现 0 个"的误导。
      const parts: string[] = [
        `已检查 ${result.checked} 个标的`,
        `新增 ${result.discovered} 条分红候选`,
      ];
      if (result.failed > 0) {
        parts.push(`${result.failed} 个标的查询失败`);
      }
      const summary = parts.join("，");
      if (result.failed > 0) {
        message.warning(summary);
      } else {
        message.success(summary);
      }
      void queryClient.invalidateQueries({ queryKey: ["pending-dividends"] });
    },
    onError: (error) => message.error(error.message),
  });
  const confirmMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: ConfirmPendingDividendInput;
    }) => api.confirmPendingDividend(id, input),
    onSuccess: () => {
      message.success("分红已确认");
      void queryClient.invalidateQueries({ queryKey: ["pending-dividends"] });
      void queryClient.invalidateQueries({ queryKey: ["ledger:query"] });
      refreshLivePages();
      setConfirmState(null);
    },
    onError: (error) => message.error(error.message),
  });
  const ignoreMutation = useMutation({
    mutationFn: (id: string) => api.ignorePendingDividend(id),
    onSuccess: () => {
      message.success("已忽略该分红候选");
      void queryClient.invalidateQueries({ queryKey: ["pending-dividends"] });
    },
    onError: (error) => message.error(error.message),
  });
  const openConfirm = (candidate: PendingDividend) => {
    setConfirmState({
      candidate,
      actualAmount: candidate.expectedAmount,
      // 候选已公告到账日时直接使用；否则置 null 强制用户填写，不默认用 exDate 代替。
      actualPaymentDate: candidate.paymentDate ? dayjs(candidate.paymentDate) : null,
      reinvest: false,
      // 默认以到账日（或除权日作 fallback 仅用于再投入日期默认值显示）作为再投入日期，
      // 用户可在弹窗中调整。
      reinvestmentDate: dayjs(candidate.paymentDate ?? candidate.exDate),
      buyPrice: null,
      buyQuantity: null,
      fee: 0,
    });
  };
  const handleIgnore = (candidate: PendingDividend) => {
    modal.confirm({
      title: "忽略该分红候选？",
      content:
        "忽略后该候选不再出现在待确认列表；如需记账请用确认或手工录入。",
      okText: "忽略",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await ignoreMutation.mutateAsync(candidate.id);
      },
    });
  };
  const submitConfirm = () => {
    if (!confirmState) return;
    // P1：候选未公告到账日时必须由用户填写 actualPaymentDate，否则后端会拒绝。
    if (!confirmState.actualPaymentDate) {
      message.error("请填写实际到账日；候选未公告到账日，不能默认用除权日代替");
      return;
    }
    const input: ConfirmPendingDividendInput = {
      actualAmount: confirmState.actualAmount,
      actualPaymentDate: confirmState.actualPaymentDate.format("YYYY-MM-DD"),
    };
    if (
      confirmState.reinvest &&
      confirmState.reinvestmentDate &&
      confirmState.buyPrice !== null &&
      confirmState.buyQuantity !== null
    ) {
      input.reinvest = {
        reinvestmentDate: confirmState.reinvestmentDate.format("YYYY-MM-DD"),
        buyPrice: confirmState.buyPrice,
        buyQuantity: confirmState.buyQuantity,
        fee: confirmState.fee,
      };
    }
    confirmMutation.mutate({ id: confirmState.candidate.id, input });
  };
  const reverseEntry = useMutation({
    mutationFn: (row: LedgerRecordView) =>
      api.reverseLedger(row.id, "用户从流水详情发起冲正"),
    onSuccess: () => {
      message.success("冲正记录已追加，原流水完整保留");
      setDetail(null);
      refreshLivePages();
    },
    onError: (error) => message.error(error.message),
  });
  const columns: ColumnsType<LedgerRecordView> = [
    {
      title: "业务日期",
      dataIndex: "businessDate",
      width: 128,
      render: (value: string) => <span className="tabular-nums">{value}</span>,
    },
    {
      title: "标的",
      key: "symbol",
      width: 190,
      render: (_, row) =>
        row.symbol ? (
          <div className="ledger-symbol">
            <strong>{row.name}</strong>
            <span>{row.symbol}</span>
          </div>
        ) : (
          <span className="finance-flat">审计记录</span>
        ),
    },
    {
      title: "类型",
      dataIndex: "type",
      width: 130,
      render: (type: EntryType, row) => (
        <Tag color={ENTRY_TYPE_TONES[type]}>
          {ENTRY_TYPE_LABELS[type]}{row.isReversed ? " · 已冲正" : ""}
        </Tag>
      ),
    },
    {
      title: "数量",
      dataIndex: "quantity",
      width: 120,
      align: "right",
      render: (value: number | null) => <span className="tabular-nums">{numberValue(value)}</span>,
    },
    {
      title: "价格",
      dataIndex: "price",
      width: 110,
      align: "right",
      render: (value: number | null) => <span className="tabular-nums">{numberValue(value, 3)}</span>,
    },
    {
      title: "发生金额",
      dataIndex: "amount",
      width: 140,
      align: "right",
      render: (_, row) => (
        <strong className="tabular-nums finance-flat">{signedAmount(row)}</strong>
      ),
    },
    {
      title: "费用",
      dataIndex: "fee",
      width: 110,
      align: "right",
      render: (value: number) => <span className="tabular-nums">{money(value)}</span>,
    },
    {
      title: "备注",
      dataIndex: "note",
      ellipsis: true,
      render: (value: string | null) => value || "—",
    },
    {
      title: "操作",
      key: "action",
      width: 92,
      align: "center",
      render: (_, row) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetail(row)}>
          查看
        </Button>
      ),
    },
  ];
  const pendingColumns: ColumnsType<PendingDividend> = [
    {
      title: "登记日",
      dataIndex: "recordDate",
      width: 110,
      render: (value: string) => <span className="tabular-nums">{value}</span>,
    },
    {
      title: "除权日",
      dataIndex: "exDate",
      width: 110,
      render: (value: string) => <span className="tabular-nums">{value}</span>,
    },
    {
      title: "标的",
      key: "symbol",
      width: 180,
      render: (_, row) => (
        <div className="ledger-symbol">
          <strong>{row.instrumentName}</strong>
          <span>{row.symbol}</span>
        </div>
      ),
    },
    {
      title: "每股分红",
      dataIndex: "perShare",
      width: 110,
      align: "right",
      render: (value: number) => (
        <span className="tabular-nums">{perShareLabel(value)}</span>
      ),
    },
    {
      title: "登记日持股",
      dataIndex: "holdingQuantity",
      width: 120,
      align: "right",
      render: (value: number) => <span className="tabular-nums">{numberValue(value)}</span>,
    },
    {
      title: "预计金额",
      dataIndex: "expectedAmount",
      width: 130,
      align: "right",
      render: (value: number) => (
        <strong className="tabular-nums finance-flat">{money(value)}</strong>
      ),
    },
    {
      title: "到账日",
      dataIndex: "paymentDate",
      width: 110,
      render: (value: string | null) =>
        value ? <span className="tabular-nums">{value}</span> : <Tag>待公告</Tag>,
    },
    {
      title: "操作",
      key: "action",
      width: 160,
      align: "center",
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" onClick={() => openConfirm(row)}>
            确认
          </Button>
          <Button
            type="link"
            size="small"
            danger
            onClick={() => handleIgnore(row)}
          >
            忽略
          </Button>
        </Space>
      ),
    },
  ];
  const handleTableChange = (pagination: TablePaginationConfig) => {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as LedgerPageSize);
  };

  return (
    <div className="live-page trades-page">
      <LivePageHeader
        title="交易流水"
        description="手工记录股票与 ETF 的买入、卖出和分红事实；投资收益由统一现金流口径重建。"
        actions={
          <>
            <span className="live-cutoff">
              数据截止：{ledger.data?.quality.updatedAt
                ? beijingDate(ledger.data.quality.updatedAt)
                : "暂无记录"}
            </span>
            <Button
              icon={<DownloadOutlined />}
              loading={exportData.isPending}
              disabled={!ledger.data?.total}
              onClick={() => exportData.mutate()}
            >
              导出流水
            </Button>
            <Button
              icon={<GiftOutlined />}
              loading={discoverMutation.isPending}
              onClick={() => discoverMutation.mutate()}
            >
              发现分红
            </Button>
            <Button
              icon={<GiftOutlined />}
              onClick={() => setReinvestmentOpen(true)}
            >
              分红并再投入
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setCorrectionTarget(null);
                setEntryModalOpen(true);
              }}
            >
              录入交易
            </Button>
          </>
        }
      />
      <section className="workspace-panel ledger-filter-panel">
        <div className="live-filter-field">
          <label>业务日期</label>
          <RangePicker
            allowClear
            value={dateRange}
            onChange={(dates) => {
              setDateRange(dates ? [dates[0]!, dates[1]!] : null);
              resetPage();
            }}
          />
        </div>
        <div className="live-filter-field">
          <label>流水类型</label>
          <Select
            mode="multiple"
            maxTagCount={2}
            allowClear
            placeholder="全部类型"
            value={entryTypes}
            options={ENTRY_TYPE_OPTIONS}
            onChange={(value) => {
              setEntryTypes(value);
              resetPage();
            }}
          />
        </div>
        <div className="live-filter-field">
          <label>资产类型</label>
          <Select
            allowClear
            placeholder="全部资产"
            value={securityType}
            options={[
              { label: "股票", value: "stock" },
              { label: "ETF", value: "etf" },
            ]}
            onChange={(value) => {
              setSecurityType(value);
              resetPage();
            }}
          />
        </div>
        <div className="live-filter-field">
          <label>证券标的</label>
          <Select
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder="全部标的"
            value={symbol}
            options={(ledger.data?.symbolOptions ?? []).map((item) => ({
              value: item.symbol,
              label: `${item.name} ${item.symbol}`,
            }))}
            onChange={(value) => {
              setSymbol(value);
              resetPage();
            }}
          />
        </div>
        <div className="live-filter-field ledger-keyword">
          <label>搜索备注</label>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="名称、代码或备注"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
              resetPage();
            }}
          />
        </div>
        <div className="ledger-filter-actions">
          <Button
            onClick={() => {
              setDateRange(null);
              setEntryTypes([]);
              setSecurityType(undefined);
              setSymbol(undefined);
              setKeyword("");
              setPage(1);
            }}
          >
            重置
          </Button>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={ledger.isFetching}
            onClick={() => void ledger.refetch()}
          >
            查询
          </Button>
        </div>
      </section>
      {pendingCandidates.length > 0 ? (
        <Card
          className="pending-dividends-panel workspace-panel"
          size="small"
          title={
            <Space align="center">
              <span>待确认分红</span>
              <Badge
                count={pendingCandidates.length}
                overflowCount={99}
                color="#f59e0b"
              />
            </Space>
          }
          extra={
            <span className="pending-dividends-hint">
              已发现 {pendingCandidates.length} 个分红候选，请确认到账或忽略
            </span>
          }
        >
          <Table
            className="pending-dividends-table"
            rowKey="id"
            columns={pendingColumns}
            dataSource={pendingCandidates}
            pagination={false}
            size="small"
            scroll={{ x: 980 }}
          />
        </Card>
      ) : null}
      {ledger.isLoading ? (
        <section className="workspace-panel"><LiveLoading rows={12} /></section>
      ) : ledger.isError ? (
        <PageError title="交易流水加载失败" error={ledger.error} onRetry={() => void ledger.refetch()} />
      ) : ledger.data ? (
        <>
          {ledger.data.integrityError ? (
            <Alert
              showIcon
              type="error"
              className="live-quality-alert"
              message="投资事实重建失败"
              description={`${ledger.data.integrityError}。事实流水仍完整保留，请从原记录详情追加修正或冲正。`}
            />
          ) : null}
          <QualityNotice quality={ledger.data.quality} />
          <LiveMetricStrip
            items={[
              { label: "有效流水", value: `${ledger.data.metrics.effectiveCount} 笔`, helper: ledger.data.metrics.reversedCount ? `另已冲正 ${ledger.data.metrics.reversedCount} 笔` : "当前筛选范围", icon: <TransactionOutlined />, tone: "blue" },
              { label: "累计买入支出", value: money(ledger.data.metrics.cumulativeBuySpend), helper: "成交金额 + 费用", icon: <SwapOutlined />, tone: "red" },
              { label: "累计卖出净收入", value: money(ledger.data.metrics.cumulativeSellNetIncome), helper: "成交金额 − 费用", icon: <SwapOutlined />, tone: "green" },
              { label: "累计分红", value: money(ledger.data.metrics.cumulativeDividend), helper: "到账金额合计", icon: <GiftOutlined />, tone: "orange" },
              { label: "累计净投入", value: money(ledger.data.metrics.netInvestment), helper: "外部买入 − 卖出净收入 − 外部分红", icon: <TransactionOutlined />, tone: "indigo" },
            ]}
          />
          <section className="workspace-panel live-table-panel">
            <div className="live-table-toolbar">
              <div>
                <strong>流水明细</strong>
                <span>按业务日期倒序，同日记录保持稳定顺序</span>
              </div>
              <span className="live-cutoff">
                最近记录：{ledger.data.quality.updatedAt ? beijingTimestamp(ledger.data.quality.updatedAt) : "暂无"}
              </span>
            </div>
            {ledger.data.rows.length ? (
              <Table
                className="live-data-table ledger-table"
                rowKey="id"
                columns={columns}
                dataSource={ledger.data.rows}
                scroll={{ x: 1280 }}
                pagination={{
                  current: ledger.data.page,
                  pageSize: ledger.data.pageSize,
                  total: ledger.data.total,
                  showSizeChanger: true,
                  pageSizeOptions: [...LIVE_LEDGER_PAGE_SIZES],
                  showTotal: (total) => `共 ${total} 条`,
                  position: ["bottomCenter"],
                }}
                rowClassName={(row) =>
                  row.isReversed ? "ledger-row-reversed" : ""
                }
                onChange={handleTableChange}
              />
            ) : (
              <LiveEmpty
                title={ledger.data.quality.status === "empty" ? "暂无交易流水" : "没有匹配的流水"}
                description={ledger.data.quality.status === "empty" ? "从第一笔买入、卖出或分红事实开始建立本地投资记录。" : "请调整筛选条件后重试。"}
                action={
                  ledger.data.quality.status === "empty" ? (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setCorrectionTarget(null);
                        setEntryModalOpen(true);
                      }}
                    >
                      录入第一笔交易
                    </Button>
                  ) : undefined
                }
              />
            )}
          </section>
          <div className="live-source-note">
            <CalendarOutlined />
            <span>本地手工录入是唯一事实源；修正采用历史重述，分析按修正后的业务事实重算，完整审计链始终保留。</span>
          </div>
        </>
      ) : null}
      <Drawer
        title="流水详情"
        width={440}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        footer={
          detail && detail.type !== "adjustment" ? (
            <div className="ledger-detail-actions">
              <Button
                disabled={detail.isReversed}
                onClick={() => {
                  setCorrectionTarget(detail);
                  setEntryModalOpen(true);
                }}
              >
                追加修正
              </Button>
              <Button
                danger
                loading={reverseEntry.isPending}
                disabled={detail.isReversed}
                onClick={() => {
                  modal.confirm({
                    title: "确认冲正这条流水？",
                    content: "系统会追加反向影响记录，原记录不会被删除；已冲正流水不能重复操作。",
                    okText: "确认冲正",
                    okButtonProps: { danger: true },
                    cancelText: "取消",
                    onOk: async () => {
                      await reverseEntry.mutateAsync(detail);
                    },
                  });
                }}
              >
                冲正
              </Button>
            </div>
          ) : null
        }
      >
        {detail ? (
          <div className="ledger-detail">
            <div className="ledger-detail-hero">
              <Tag color={ENTRY_TYPE_TONES[detail.type]}>{ENTRY_TYPE_LABELS[detail.type]}</Tag>
              <strong className="tabular-nums finance-flat">{signedAmount(detail)}</strong>
              <span>{detail.businessDate}</span>
            </div>
            <dl>
              <div><dt>证券标的</dt><dd>{detail.symbol ? `${detail.name} ${detail.symbol}` : "审计记录"}</dd></div>
              <div><dt>数量</dt><dd>{numberValue(detail.quantity)}</dd></div>
              <div><dt>成交价格</dt><dd>{numberValue(detail.price, 3)}</dd></div>
              <div><dt>交易费用</dt><dd>{money(detail.fee)}</dd></div>
              <div><dt>每股分红</dt><dd>{numberValue(detail.perShare, 4)}</dd></div>
              <div><dt>登记日</dt><dd>{detail.recordDate ?? "—"}</dd></div>
              <div><dt>录入时间</dt><dd>{beijingTimestamp(detail.recordedAt)}</dd></div>
              <div><dt>修正时间</dt><dd>{detail.correctedAt ? beijingTimestamp(detail.correctedAt) : "—"}</dd></div>
              <div>
                <dt>关联操作</dt>
                <dd>
                  {detail.linkedOperation === "dividend_reinvestment"
                    ? "分红并再投入"
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>关联记录</dt>
                <dd>
                  {detail.linkedRecords.length
                    ? detail.linkedRecords.map((linked) => (
                        <Button
                          key={linked.id}
                          type="link"
                          size="small"
                          onClick={() => {
                            void api
                              .getLedgerRecord(linked.id)
                              .then(setDetail)
                              .catch((error: unknown) =>
                                message.error(
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                                ),
                              );
                          }}
                        >
                          {linked.type === "dividend" ? "分红到账" : "买入"}{" "}
                          {linked.businessDate}
                        </Button>
                      ))
                    : "—"}
                </dd>
              </div>
              <div><dt>备注</dt><dd>{detail.note ?? "—"}</dd></div>
              <div><dt>记录状态</dt><dd>{detail.isReversed ? "已冲正" : detail.correctsEntryId ? "修正后的有效记录" : detail.type === "adjustment" ? "冲正 / 修正记录" : "有效"}</dd></div>
            </dl>
          </div>
        ) : null}
      </Drawer>
      <LedgerEntryModal
        open={entryModalOpen}
        correctionTarget={correctionTarget}
        stocks={instruments}
        catalogStatus={catalogStatus}
        onRetryCatalog={(type) =>
          void (type === "stock" ? stockCatalog.refetch() : etfCatalog.refetch())
        }
        onClose={() => {
          setEntryModalOpen(false);
          setCorrectionTarget(null);
        }}
        onSaved={() => {
          setDetail(null);
          refreshLivePages();
        }}
      />
      <DividendReinvestmentModal
        open={reinvestmentOpen}
        stocks={instruments}
        catalogStatus={catalogStatus}
        onRetryCatalog={(type) =>
          void (type === "stock" ? stockCatalog.refetch() : etfCatalog.refetch())
        }
        onClose={() => setReinvestmentOpen(false)}
        onSaved={refreshLivePages}
      />
      <Modal
        className="pending-confirm-modal-wrapper"
        width={560}
        centered
        destroyOnClose
        maskClosable={false}
        title="确认分红到账"
        open={confirmState !== null}
        confirmLoading={confirmMutation.isPending}
        okText="确认到账"
        cancelText="取消"
        onCancel={confirmMutation.isPending ? undefined : () => setConfirmState(null)}
        onOk={() => submitConfirm()}
      >
        {confirmState ? (
          <div className="pending-confirm-modal">
            <Alert
              showIcon
              type="info"
              message="确认后系统将写入一条正式分红流水；如勾选再投入会同步追加买入事实。"
            />
            <dl className="pending-confirm-summary">
              <div>
                <dt>证券标的</dt>
                <dd>
                  {confirmState.candidate.instrumentName}{" "}
                  {confirmState.candidate.symbol}
                </dd>
              </div>
              <div>
                <dt>登记日</dt>
                <dd className="tabular-nums">
                  {confirmState.candidate.recordDate}
                </dd>
              </div>
              <div>
                <dt>除权日</dt>
                <dd className="tabular-nums">{confirmState.candidate.exDate}</dd>
              </div>
              {confirmState.candidate.paymentDate ? (
                <div>
                  <dt>公告到账日</dt>
                  <dd className="tabular-nums">
                    {confirmState.candidate.paymentDate}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>每股分红</dt>
                <dd className="tabular-nums">
                  {perShareLabel(confirmState.candidate.perShare)}
                </dd>
              </div>
              <div>
                <dt>登记日持股</dt>
                <dd className="tabular-nums">
                  {numberValue(confirmState.candidate.holdingQuantity)}
                </dd>
              </div>
              <div>
                <dt>预计金额</dt>
                <dd className="tabular-nums finance-flat">
                  {money(confirmState.candidate.expectedAmount)}
                </dd>
              </div>
            </dl>
            <div className="pending-confirm-field">
              <label>
                {confirmState.candidate.paymentDate
                  ? "实际到账日"
                  : "实际到账日（必填）"}
              </label>
              <DatePicker
                allowClear={false}
                value={confirmState.actualPaymentDate}
                onChange={(value) =>
                  setConfirmState((state) =>
                    state ? { ...state, actualPaymentDate: value } : state,
                  )
                }
                disabledDate={(current) => {
                  // 到账日不得早于除权日
                  return !!current && current.isBefore(dayjs(confirmState.candidate.exDate), "day");
                }}
              />
              {!confirmState.candidate.paymentDate ? (
                <span className="pending-confirm-hint">
                  候选未公告到账日，请按券商实际到账日填写，不能默认用除权日代替
                </span>
              ) : null}
            </div>
            <div className="pending-confirm-field">
              <label>实际到账金额</label>
              <InputNumber
                value={confirmState.actualAmount}
                min={0.01}
                precision={2}
                prefix="¥"
                onChange={(value) =>
                  setConfirmState((state) =>
                    state
                      ? { ...state, actualAmount: Number(value ?? 0) }
                      : state,
                  )
                }
              />
            </div>
            <Checkbox
              className="pending-confirm-reinvest-toggle"
              checked={confirmState.reinvest}
              onChange={(event) =>
                setConfirmState((state) =>
                  state ? { ...state, reinvest: event.target.checked } : state,
                )
              }
            >
              同时进行分红再投入
            </Checkbox>
            {confirmState.reinvest ? (
              <div className="pending-confirm-reinvest-fields">
                <div className="pending-confirm-field">
                  <label>再投入日期</label>
                  <DatePicker
                    allowClear={false}
                    value={confirmState.reinvestmentDate}
                    onChange={(value) =>
                      setConfirmState((state) =>
                        state ? { ...state, reinvestmentDate: value } : state,
                      )
                    }
                  />
                </div>
                <div className="pending-confirm-field">
                  <label>买入价格</label>
                  <InputNumber
                    value={confirmState.buyPrice}
                    min={0.0001}
                    precision={4}
                    prefix="¥"
                    onChange={(value) =>
                      setConfirmState((state) =>
                        state
                          ? { ...state, buyPrice: value ?? null }
                          : state,
                      )
                    }
                  />
                </div>
                <div className="pending-confirm-field">
                  <label>买入数量</label>
                  <InputNumber
                    value={confirmState.buyQuantity}
                    min={1}
                    precision={0}
                    onChange={(value) =>
                      setConfirmState((state) =>
                        state
                          ? { ...state, buyQuantity: value ?? null }
                          : state,
                      )
                    }
                  />
                </div>
                <div className="pending-confirm-field">
                  <label>买入费用</label>
                  <InputNumber
                    value={confirmState.fee}
                    min={0}
                    precision={2}
                    prefix="¥"
                    onChange={(value) =>
                      setConfirmState((state) =>
                        state
                          ? { ...state, fee: Number(value ?? 0) }
                          : state,
                      )
                    }
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
