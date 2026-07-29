import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Segmented,
  Select,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CalendarOutlined,
  DownloadOutlined,
  GiftOutlined,
  LineChartOutlined,
  RiseOutlined,
  StockOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useNavigate } from "react-router-dom";
import {
  api,
  type IncomeCalendarQuery,
  type IncomeCalendarScope,
  type IncomeContribution,
} from "../api/client";
import { ENTRY_TYPE_LABELS, ENTRY_TYPE_TONES } from "./live/liveConstants";
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

function monthGrid(month: string): Array<{ date: string; inMonth: boolean }> {
  const first = dayjs(`${month}-01`);
  const mondayOffset = (first.day() + 6) % 7;
  const start = first.subtract(mondayOffset, "day");
  return Array.from({ length: 42 }, (_, index) => {
    const value = start.add(index, "day");
    return { date: value.format("YYYY-MM-DD"), inMonth: value.format("YYYY-MM") === month };
  });
}

export function IncomeCalendarPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [scope, setScope] = useState<IncomeCalendarScope>("all");
  const [symbol, setSymbol] = useState<string>();
  const [selectedDate, setSelectedDate] = useState<string>();
  const query: IncomeCalendarQuery = useMemo(
    () => ({ month, scope, symbol }),
    [month, scope, symbol],
  );
  const calendar = useQuery({
    queryKey: ["income-calendar", query],
    queryFn: () => api.getIncomeCalendar(query),
  });
  const exportData = useMutation({
    mutationFn: () => api.exportIncomeCalendar(query),
    onSuccess: (result) => {
      if (!result.cancelled) message.success("收益日历已导出");
    },
    onError: (error) => message.error(error.message),
  });
  useEffect(() => {
    const days = calendar.data?.days ?? [];
    if (selectedDate?.startsWith(month) && days.some((day) => day.date === selectedDate)) {
      return;
    }
    setSelectedDate(days.at(-1)?.date ?? `${month}-01`);
  }, [calendar.data?.days, month, selectedDate]);
  const dayMap = useMemo(
    () => new Map((calendar.data?.days ?? []).map((day) => [day.date, day])),
    [calendar.data?.days],
  );
  const cells = useMemo(() => monthGrid(month), [month]);
  const selectedDay = dayMap.get(selectedDate ?? "");
  const heatMax = Math.max(
    1,
    ...(calendar.data?.days ?? []).map((day) => Math.abs(day.totalPnl ?? 0)),
  );
  const contributionColumns: ColumnsType<IncomeContribution> = [
    {
      title: "标的",
      key: "symbol",
      render: (_, row) => (
        <div className="ledger-symbol">
          <strong>{row.name}</strong>
          <span>{row.symbol}</span>
        </div>
      ),
    },
    {
      title: "持仓变动",
      dataIndex: "holdingChange",
      width: 100,
      align: "right",
      render: (value: number) => (
        <span className="tabular-nums">{value === 0 ? "—" : numberValue(value)}</span>
      ),
    },
    {
      title: "市场价变",
      dataIndex: "marketPricePnl",
      width: 100,
      align: "right",
      render: (value: number | null) => (
        <span className={`tabular-nums ${pnlClass(value)}`}>
          {money(value, true)}
        </span>
      ),
    },
    {
      title: "分红",
      dataIndex: "dividendPnl",
      width: 90,
      align: "right",
      render: (value: number) => (
        <span className="tabular-nums">{money(value)}</span>
      ),
    },
    {
      title: "交易影响",
      dataIndex: "tradingCostPnl",
      width: 100,
      align: "right",
      render: (value: number) => (
        <span className={`tabular-nums ${pnlClass(value)}`}>
          {money(value, true)}
        </span>
      ),
    },
    {
      title: "当日贡献",
      dataIndex: "totalPnl",
      width: 120,
      align: "right",
      render: (value: number | null) => (
        <strong className={`tabular-nums ${pnlClass(value)}`}>{money(value, true)}</strong>
      ),
    },
  ];
  const moveMonth = (delta: number) => {
    setMonth(dayjs(`${month}-01`).add(delta, "month").format("YYYY-MM"));
    setSelectedDate(undefined);
  };

  return (
    <div className="live-page income-page">
      <LivePageHeader
        title="收益日历"
        description="按日查看市场价格收益、分红收益与交易影响；外部投入不被当作收益。"
        actions={
          <>
            <Button icon={<ArrowLeftOutlined />} aria-label="上一个月" onClick={() => moveMonth(-1)} />
            <DatePicker
              picker="month"
              allowClear={false}
              value={dayjs(`${month}-01`)}
              onChange={(value: Dayjs) => {
                setMonth(value.format("YYYY-MM"));
                setSelectedDate(undefined);
              }}
            />
            <Button icon={<ArrowRightOutlined />} aria-label="下一个月" onClick={() => moveMonth(1)} />
            <Button
              icon={<DownloadOutlined />}
              loading={exportData.isPending}
              disabled={!calendar.data?.days.length}
              onClick={() => exportData.mutate()}
            >
              导出
            </Button>
          </>
        }
      />
      <section className="workspace-panel income-filter-bar">
        <div className="live-filter-field">
          <label>统计范围</label>
          <Segmented
            value={scope}
            options={[
              { label: "全部历史持仓", value: "all" },
              { label: "当前持仓", value: "current" },
            ]}
            onChange={(value) => {
              setScope(value as IncomeCalendarScope);
              setSymbol(undefined);
            }}
          />
        </div>
        <div className="live-filter-field income-symbol-filter">
          <label>标的筛选</label>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部标的"
            value={symbol}
            options={(calendar.data?.symbolOptions ?? [])
              .filter((item) => scope === "all" || item.isCurrent)
              .map((item) => ({
                value: item.symbol,
                label: `${item.name} ${item.symbol}`,
              }))}
            onChange={setSymbol}
          />
        </div>
        <div className="income-scope-note">
          <CalendarOutlined />
          <span>
            {calendar.data?.scopeLabel ?? "全部历史持仓"} · {month}
            {calendar.data
              ? ` · 截止 ${calendar.data.quality.dataCutoff ?? "—"} · ${calendar.data.valuationSource}`
              : ""}
          </span>
        </div>
      </section>
      {calendar.isLoading ? (
        <section className="workspace-panel"><LiveLoading rows={13} /></section>
      ) : calendar.isError ? (
        <PageError title="收益日历加载失败" error={calendar.error} onRetry={() => void calendar.refetch()} />
      ) : calendar.data ? (
        <>
          <QualityNotice quality={calendar.data.quality} />
          <LiveMetricStrip
            items={[
              { label: "本月收益", value: money(calendar.data.metrics.month.amount, true), helper: percent(calendar.data.metrics.month.rate, true), icon: <TrophyOutlined />, tone: "blue", valueClass: pnlClass(calendar.data.metrics.month.amount) },
              { label: "市场价格收益", value: money(calendar.data.metrics.marketPrice.amount, true), helper: percent(calendar.data.metrics.marketPrice.rate, true), icon: <LineChartOutlined />, tone: "red", valueClass: pnlClass(calendar.data.metrics.marketPrice.amount) },
              { label: "分红收益", value: money(calendar.data.metrics.dividend.amount), helper: "现金分红到账", icon: <GiftOutlined />, tone: "orange" },
              { label: "累计收益", value: money(calendar.data.metrics.cumulative.amount, true), helper: percent(calendar.data.metrics.cumulative.rate, true), icon: <RiseOutlined />, tone: "green", valueClass: pnlClass(calendar.data.metrics.cumulative.amount) },
              { label: "年内收益", value: money(calendar.data.metrics.yearToDate.amount, true), helper: percent(calendar.data.metrics.yearToDate.rate, true), icon: <StockOutlined />, tone: "violet", valueClass: pnlClass(calendar.data.metrics.yearToDate.amount) },
            ]}
          />
          {calendar.data.metrics.month.amount !== null ? (
            <div className="income-cumulative-breakdown">
              本月收益 = 本月市场价格 {money(calendar.data.metrics.marketPrice.amount, true)} + 本月分红 {money(calendar.data.metrics.dividend.amount)} + 本月交易影响 {money(calendar.data.metrics.tradingCost.amount, true)}
            </div>
          ) : null}
          {calendar.data.quality.status === "empty" ? (
            <section className="workspace-panel">
              <LiveEmpty title="暂无收益记录" description="收益日历只读取本地实盘流水与行情，不提供交易录入或流水导入。" />
            </section>
          ) : (
            <section className="workspace-panel income-calendar-panel">
              <div className="income-calendar-main">
                <div className="calendar-week-header">
                  {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="calendar-grid">
                  {cells.map((cell) => {
                    const day = dayMap.get(cell.date);
                    const ratio = Math.min(1, Math.abs(day?.totalPnl ?? 0) / heatMax);
                    const level = ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : ratio > 0 ? 1 : 0;
                    const direction =
                      (day?.totalPnl ?? 0) > 0 ? "profit" : (day?.totalPnl ?? 0) < 0 ? "loss" : "flat";
                    return (
                      <button
                        type="button"
                        key={cell.date}
                        className={[
                          "calendar-cell",
                          cell.inMonth ? "" : "outside",
                          selectedDate === cell.date ? "selected" : "",
                          day?.isPartial ? "partial" : "",
                        ].join(" ")}
                        onClick={() => setSelectedDate(cell.date)}
                      >
                        <span className="calendar-day-number">{dayjs(cell.date).date()}</span>
                        {day ? (
                          <>
                            <strong className={`tabular-nums ${pnlClass(day.totalPnl)}`}>
                              {money(day.totalPnl, true)}
                            </strong>
                            <small>
                              价变 {money(day.marketPricePnl, true)}
                              {day.dividendPnl ? ` · 分红 ${money(day.dividendPnl)}` : ""}
                              {day.tradingCostPnl ? ` · 交易 ${money(day.tradingCostPnl, true)}` : ""}
                            </small>
                            <i className={`calendar-heat ${direction} level-${level}`} />
                            {day.dividendPnl > 0 ? <b className="dividend-dot" title="当日有现金分红" /> : null}
                          </>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <aside className="income-day-detail">
                <div className="day-detail-heading">
                  <div>
                    <span>日期明细</span>
                    <strong>{selectedDate ?? "—"}</strong>
                  </div>
                  <Tag>{calendar.data.scopeLabel}</Tag>
                </div>
                {selectedDay ? (
                  <>
                    <div className="day-summary">
                      <div>
                        <span>当日总收益</span>
                        <strong className={pnlClass(selectedDay.totalPnl)}>{money(selectedDay.totalPnl, true)}</strong>
                      </div>
                      <div>
                        <span>当日收益率</span>
                        <strong className={pnlClass(selectedDay.returnRate)}>{percent(selectedDay.returnRate, true)}</strong>
                      </div>
                      <div>
                        <span>市场价格</span>
                        <strong className={pnlClass(selectedDay.marketPricePnl)}>{money(selectedDay.marketPricePnl, true)}</strong>
                      </div>
                      <div>
                        <span>现金分红</span>
                        <strong>{money(selectedDay.dividendPnl)}</strong>
                      </div>
                      <div>
                        <span>交易影响</span>
                        <strong className={pnlClass(selectedDay.tradingCostPnl)}>{money(selectedDay.tradingCostPnl, true)}</strong>
                      </div>
                    </div>
                    <h3>标的贡献</h3>
                    {selectedDay.contributions.length ? (
                      <Table
                        className="income-contribution-table"
                        size="small"
                        rowKey="symbol"
                        columns={contributionColumns}
                        dataSource={selectedDay.contributions}
                        pagination={false}
                      />
                    ) : (
                      <LiveEmpty title="当日无标的贡献" description="可能是非交易日或当日没有投资事实。" />
                    )}
                    <h3>当日事件</h3>
                    {selectedDay.events.length ? (
                      <div className="income-event-list">
                        {selectedDay.events.map((event, index) => (
                          <button
                            type="button"
                            key={`${event.type}-${event.symbol ?? "cash"}-${index}`}
                            onClick={() =>
                              navigate(
                                `/trades?${new URLSearchParams({
                                  ...(event.symbol ? { symbol: event.symbol } : {}),
                                  date: selectedDay.date,
                                }).toString()}`,
                              )
                            }
                          >
                            <Tag color={ENTRY_TYPE_TONES[event.type]}>
                              {ENTRY_TYPE_LABELS[event.type]}
                            </Tag>
                            <span>{event.name ?? "审计记录"}</span>
                            <strong>{money(event.amount)}</strong>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="day-no-events">当日无交易或分红事件</div>
                    )}
                  </>
                ) : (
                  <LiveEmpty title="当日暂无记录" description="选择有收益或事件的日期查看详情。" />
                )}
              </aside>
            </section>
          )}
          <div className="calendar-legend">
            <span><i className="legend-swatch profit" /> 正收益</span>
            <span><i className="legend-swatch loss" /> 负收益</span>
            <span><i className="dividend-dot static" /> 现金分红</span>
            <span>无数据以“—”显示，不使用零值替代。</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
