import { useMemo, useState } from "react";
import {
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
  SearchOutlined,
  SwapOutlined,
  TransactionOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useSearchParams } from "react-router-dom";
import {
  api,
  type EntryType,
  type LedgerQuery,
  type LedgerRecordView,
  type SecurityType,
} from "../api/client";
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

const { RangePicker } = DatePicker;
type LedgerPageSize = 20 | 50 | 100;

function amountClass(type: EntryType): string {
  if (["sell", "dividend", "transfer_in"].includes(type)) return "finance-profit";
  if (["buy", "transfer_out"].includes(type)) return "finance-loss";
  return "finance-flat";
}

function signedAmount(row: LedgerRecordView): string {
  const value = row.amount;
  if (value === null) return "—";
  if (["sell", "dividend", "transfer_in"].includes(row.type)) return money(value, true);
  if (["buy", "transfer_out"].includes(row.type)) return money(-value);
  return money(value);
}

export function TradesPage() {
  const { message } = App.useApp();
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
  const exportData = useMutation({
    mutationFn: () => api.exportLedger(query),
    onSuccess: (result) => {
      if (!result.cancelled) message.success("交易流水已导出");
    },
    onError: (error) => message.error(error.message),
  });
  const resetPage = () => setPage(1);
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
          <span className="finance-flat">账户资金</span>
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
        description="按业务日期查看本地资金与证券事实记录；本页不提供录入、导入或修改入口。"
        actions={
          <Button
            icon={<DownloadOutlined />}
            loading={exportData.isPending}
            disabled={!ledger.data?.total}
            onClick={() => exportData.mutate()}
          >
            导出流水
          </Button>
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
      </section>
      {ledger.isLoading ? (
        <section className="workspace-panel"><LiveLoading rows={12} /></section>
      ) : ledger.isError ? (
        <PageError title="交易流水加载失败" error={ledger.error} onRetry={() => void ledger.refetch()} />
      ) : ledger.data ? (
        <>
          <QualityNotice quality={ledger.data.quality} />
          <LiveMetricStrip
            items={[
              { label: "流水记录", value: `${ledger.data.metrics.recordCount} 条`, helper: "当前筛选范围", icon: <TransactionOutlined />, tone: "blue" },
              { label: "买入金额", value: money(ledger.data.metrics.totalBuy), helper: "含交易费用", icon: <SwapOutlined />, tone: "red" },
              { label: "卖出金额", value: money(ledger.data.metrics.totalSell), helper: "扣除交易费用", icon: <SwapOutlined />, tone: "green" },
              { label: "现金分红", value: money(ledger.data.metrics.totalDividend), helper: "到账金额合计", icon: <GiftOutlined />, tone: "orange" },
              { label: "净资金转入", value: money(ledger.data.metrics.netTransferIn, true), helper: "转入减转出", icon: <WalletOutlined />, tone: "indigo" },
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
                  pageSizeOptions: [20, 50, 100],
                  showTotal: (total) => `共 ${total} 条`,
                }}
                onChange={handleTableChange}
              />
            ) : (
              <LiveEmpty
                title={ledger.data.quality.status === "empty" ? "暂无交易流水" : "没有匹配的流水"}
                description={ledger.data.quality.status === "empty" ? "当前没有本地实盘记录；本页不提供录入或导入入口。" : "请调整筛选条件后重试。"}
              />
            )}
          </section>
          <div className="live-source-note">
            <CalendarOutlined />
            <span>业务日期是事实口径；冲正记录与被冲正原记录均保留并明确标识。</span>
          </div>
        </>
      ) : null}
      <Drawer
        title="流水详情"
        width={440}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="ledger-detail">
            <div className="ledger-detail-hero">
              <Tag color={ENTRY_TYPE_TONES[detail.type]}>{ENTRY_TYPE_LABELS[detail.type]}</Tag>
              <strong className={`tabular-nums ${amountClass(detail.type)}`}>{signedAmount(detail)}</strong>
              <span>{detail.businessDate}</span>
            </div>
            <dl>
              <div><dt>证券标的</dt><dd>{detail.symbol ? `${detail.name} ${detail.symbol}` : "账户资金"}</dd></div>
              <div><dt>数量</dt><dd>{numberValue(detail.quantity)}</dd></div>
              <div><dt>成交价格</dt><dd>{numberValue(detail.price, 3)}</dd></div>
              <div><dt>交易费用</dt><dd>{money(detail.fee)}</dd></div>
              <div><dt>每股分红</dt><dd>{numberValue(detail.perShare, 4)}</dd></div>
              <div><dt>登记日</dt><dd>{detail.recordDate ?? "—"}</dd></div>
              <div><dt>到账日</dt><dd>{detail.paymentDate ?? "—"}</dd></div>
              <div><dt>逆回购到期日</dt><dd>{detail.maturityDate ?? "—"}</dd></div>
              <div><dt>备注</dt><dd>{detail.note ?? "—"}</dd></div>
              <div><dt>记录状态</dt><dd>{detail.isReversed ? "已冲正" : detail.type === "adjustment" ? "冲正 / 修正记录" : "有效"}</dd></div>
            </dl>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
