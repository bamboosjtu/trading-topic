import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Drawer,
  Input,
  Select,
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
  type EntryType,
  type LedgerQuery,
  type LedgerRecordView,
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

const { RangePicker } = DatePicker;
type LedgerPageSize = (typeof LIVE_LEDGER_PAGE_SIZES)[number];

function amountClass(type: EntryType): string {
  if (["sell", "dividend"].includes(type)) return "finance-profit";
  if (type === "buy") return "finance-loss";
  return "finance-flat";
}

function signedAmount(row: LedgerRecordView): string {
  const value = row.amount;
  if (value === null) return "—";
  if (["sell", "dividend"].includes(row.type)) return money(value, true);
  if (row.type === "buy") return money(-value);
  return money(value);
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
  const stocks = useQuery({
    queryKey: ["stocks"],
    queryFn: api.listStocks,
    staleTime: 24 * 60 * 60 * 1000,
  });
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
        <strong className={`tabular-nums ${amountClass(row.type)}`}>{signedAmount(row)}</strong>
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
                ? dayjs(ledger.data.quality.updatedAt).format("YYYY-MM-DD")
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
              { label: "流水记录", value: `${ledger.data.metrics.recordCount} 条`, helper: "当前筛选范围", icon: <TransactionOutlined />, tone: "blue" },
              { label: "累计买入支出", value: money(ledger.data.metrics.cumulativeBuySpend), helper: "成交金额 + 费用", icon: <SwapOutlined />, tone: "red" },
              { label: "累计卖出净收入", value: money(ledger.data.metrics.cumulativeSellNetIncome), helper: "成交金额 − 费用", icon: <SwapOutlined />, tone: "green" },
              { label: "累计分红", value: money(ledger.data.metrics.cumulativeDividend), helper: "到账金额合计", icon: <GiftOutlined />, tone: "orange" },
              { label: "累计净投入", value: money(ledger.data.metrics.netInvestment), helper: "买入支出 − 卖出净收入 − 分红", icon: <TransactionOutlined />, tone: "indigo" },
            ]}
          />
          <section className="workspace-panel live-table-panel">
            <div className="live-table-toolbar">
              <div>
                <strong>流水明细</strong>
                <span>按业务日期倒序，同日记录保持稳定顺序</span>
              </div>
              <span className="live-cutoff">
                最近记录：{ledger.data.quality.updatedAt ? dayjs(ledger.data.quality.updatedAt).format("YYYY-MM-DD HH:mm") : "暂无"}
              </span>
            </div>
            {ledger.data.rows.length ? (
              <Table
                className="live-data-table ledger-table"
                rowKey="id"
                columns={columns}
                dataSource={ledger.data.rows}
                pagination={{
                  current: ledger.data.page,
                  pageSize: ledger.data.pageSize,
                  total: ledger.data.total,
                  showSizeChanger: true,
                  pageSizeOptions: [...LIVE_LEDGER_PAGE_SIZES],
                  showTotal: (total) => `共 ${total} 条`,
                }}
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
              <strong className={`tabular-nums ${amountClass(detail.type)}`}>{signedAmount(detail)}</strong>
              <span>{detail.businessDate}</span>
            </div>
            <dl>
              <div><dt>证券标的</dt><dd>{detail.symbol ? `${detail.name} ${detail.symbol}` : "审计记录"}</dd></div>
              <div><dt>数量</dt><dd>{numberValue(detail.quantity)}</dd></div>
              <div><dt>成交价格</dt><dd>{numberValue(detail.price, 3)}</dd></div>
              <div><dt>交易费用</dt><dd>{money(detail.fee)}</dd></div>
              <div><dt>每股分红</dt><dd>{numberValue(detail.perShare, 4)}</dd></div>
              <div><dt>登记日</dt><dd>{detail.recordDate ?? "—"}</dd></div>
              <div><dt>到账日</dt><dd>{detail.paymentDate ?? "—"}</dd></div>
              <div><dt>录入时间</dt><dd>{dayjs(detail.recordedAt).format("YYYY-MM-DD HH:mm:ss")}</dd></div>
              <div><dt>修正时间</dt><dd>{detail.correctedAt ? dayjs(detail.correctedAt).format("YYYY-MM-DD HH:mm:ss") : "—"}</dd></div>
              <div><dt>关联分组</dt><dd>{detail.linkedGroupId ?? "—"}</dd></div>
              <div><dt>备注</dt><dd>{detail.note ?? "—"}</dd></div>
              <div><dt>记录状态</dt><dd>{detail.isReversed ? "已冲正" : detail.correctsEntryId ? "修正后的有效记录" : detail.type === "adjustment" ? "冲正 / 修正记录" : "有效"}</dd></div>
            </dl>
          </div>
        ) : null}
      </Drawer>
      <LedgerEntryModal
        open={entryModalOpen}
        correctionTarget={correctionTarget}
        stocks={stocks.data ?? []}
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
        stocks={stocks.data ?? []}
        onClose={() => setReinvestmentOpen(false)}
        onSaved={refreshLivePages}
      />
    </div>
  );
}
