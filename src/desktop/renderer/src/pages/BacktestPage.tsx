import { useMemo, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  PlayCircleOutlined,
  HistoryOutlined,
  LineChartOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  api,
  type BacktestRequest,
  type BacktestResult,
  type SimpleBacktestResult,
  type SimpleBacktestRow,
} from "../api/client";

const { Title, Text } = Typography;
const BANK_OPTIONS = [
  ["601398", "工商银行"],
  ["601939", "建设银行"],
  ["601288", "农业银行"],
  ["601988", "中国银行"],
  ["600036", "招商银行"],
  ["601166", "兴业银行"],
  ["600016", "民生银行"],
].map(([value, name]) => ({ value, label: `${name} · ${value}` }));

const EVENT_LABELS: Record<SimpleBacktestRow["event"], string> = {
  buy: "定投买入",
  dividend: "分红到账",
  ex_right: "除权调整",
};

const EVENT_COLORS: Record<SimpleBacktestRow["event"], string> = {
  buy: "gold",
  dividend: "success",
  ex_right: "warning",
};

function dateYearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

function percent(value: number | null): string {
  return value === null ? "不可计算" : `${(value * 100).toFixed(2)}%`;
}

/** 从 BacktestResult 推导简化回测请求（用于查看历史结果时回填参数） */
function deriveSimpleRequest(record: BacktestResult): BacktestRequest {
  return {
    symbols: [record.symbol],
    startDate: record.requestedStartDate || record.actualStartDate,
    endDate: record.actualEndDate,
    monthlyAmount: record.monthlyAmount,
    buyDay: record.buyDay,
  };
}

export function BacktestPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<BacktestRequest>();
  const [currentResults, setCurrentResults] = useState<BacktestResult[]>([]);
  const [currentRequest, setCurrentRequest] = useState<BacktestRequest | null>(null);
  const [detail, setDetail] = useState<BacktestResult | null>(null);
  const history = useQuery({
    queryKey: ["backtests"],
    queryFn: api.listBacktests,
  });
  const mutation = useMutation({
    mutationFn: api.runBacktest,
    onSuccess: (results, variables) => {
      setCurrentResults(results);
      setCurrentRequest(variables);
      void queryClient.invalidateQueries({ queryKey: ["backtests"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      message.success(`已完成 ${results.length} 个标的回测`);
    },
    onError: (error) => message.error(error.message),
  });

  // 简化回测数据按当前选中标的 + 当前请求参数获取
  const simpleRequest = useMemo<BacktestRequest | null>(() => {
    if (!detail) return null;
    if (currentRequest) {
      return { ...currentRequest, symbols: [detail.symbol] };
    }
    return deriveSimpleRequest(detail);
  }, [detail, currentRequest]);

  const simpleQuery = useQuery({
    queryKey: ["backtest:simple", simpleRequest],
    queryFn: () => api.runSimpleBacktest(simpleRequest!),
    enabled: Boolean(simpleRequest),
    staleTime: 60_000,
  });

  const simpleResult: SimpleBacktestResult | undefined = useMemo(
    () => simpleQuery.data?.find((row) => row.symbol === detail?.symbol),
    [simpleQuery.data, detail?.symbol],
  );

  const results = currentResults.length ? currentResults : history.data?.slice(0, 4) ?? [];

  const chartOption = useMemo(
    () => ({
      animationDuration: 500,
      tooltip: {
        trigger: "axis",
        backgroundColor: "#ffffff",
        borderColor: "#e9e3d6",
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: "#1e1c18", fontSize: 12 },
        extraCssText:
          "box-shadow: 0 8px 24px -8px rgba(69, 58, 33, 0.25); border-radius: 8px;",
        valueFormatter: (value: number) => money(value),
      },
      axisPointer: {
        type: "line",
        lineStyle: { color: "#d8cfba", type: "dashed" },
      },
      grid: { left: 16, right: 24, top: 36, bottom: 24, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        icon: "roundRect",
        itemWidth: 14,
        itemHeight: 4,
        textStyle: { color: "#7b7668", fontSize: 12 },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: results[0]?.equityCurve.map((row) => row.date) ?? [],
        axisLabel: { hideOverlap: true, color: "#a39e8d", fontSize: 11 },
        axisLine: { lineStyle: { color: "#e0d9c8" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: "#a39e8d",
          fontSize: 11,
          formatter: (value: number) => `${Math.round(value / 10_000)}万`,
        },
        splitLine: { lineStyle: { color: "#f0ebdf" } },
      },
      series: results.map((result) => ({
        name: result.name,
        type: "line",
        showSymbol: false,
        smooth: 0.15,
        data: result.equityCurve.map((row) => row.asset),
        lineStyle: { width: 2.5 },
        areaStyle: { opacity: 0.05 },
        emphasis: { focus: "series" },
      })),
      color: ["#c79345", "#226186", "#3e7d5b", "#97506b"],
    }),
    [results],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="page-eyebrow">Historical Simulation</div>
          <Title level={2} className="!mt-1.5 !mb-1.5 !text-[24px] tracking-tight">
            历史回测
          </Title>
          <Text type="secondary" className="text-[13px]">
            固定金额、整数手、现金结转与现金分红回购；同一条件最多并排 4 个 A 股。
          </Text>
        </div>
        <Tag icon={<HistoryOutlined />} bordered={false} color="gold" className="!mr-0">
          已保存 {history.data?.length ?? 0} 次结果
        </Tag>
      </div>

      <div className="workspace-panel px-6 pt-6 pb-5">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            symbols: ["601398"],
            startDate: dateYearsAgo(5),
            endDate: new Date().toISOString().slice(0, 10),
            monthlyAmount: 3000,
            buyDay: 1,
          }}
          onFinish={(values) => mutation.mutate(values)}
        >
          <div className="grid grid-cols-[minmax(280px,1.5fr)_repeat(4,minmax(120px,0.7fr))_auto] gap-3 items-end">
            <Form.Item
              name="symbols"
              label="A 股标的"
              rules={[{ required: true, message: "至少选择一个标的" }]}
              className="!mb-0"
            >
              <Select
                mode="tags"
                maxCount={4}
                tokenSeparators={[",", "，", " "]}
                options={BANK_OPTIONS}
                placeholder="输入 6 位股票代码"
                size="large"
              />
            </Form.Item>
            <Form.Item name="startDate" label="开始日期" className="!mb-0">
              <Input type="date" size="large" />
            </Form.Item>
            <Form.Item name="endDate" label="结束日期" className="!mb-0">
              <Input type="date" size="large" />
            </Form.Item>
            <Form.Item name="monthlyAmount" label="每月投入" className="!mb-0">
              <InputNumber min={100} step={500} suffix="元" className="w-full" size="large" />
            </Form.Item>
            <Form.Item name="buyDay" label="指定买入日" className="!mb-0">
              <InputNumber min={1} max={28} suffix="日" className="w-full" size="large" />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<PlayCircleOutlined />}
              loading={mutation.isPending}
              size="large"
            >
              开始回测
            </Button>
          </div>
          <div className="mt-5 pt-4 border-t border-line-soft text-xs text-ink-500">
            <Space size={8} wrap>
              <span>快捷区间</span>
              {[3, 5, 10].map((years) => (
                <Button
                  key={years}
                  type="link"
                  size="small"
                  className="!px-0"
                  onClick={() =>
                    form.setFieldsValue({
                      startDate: dateYearsAgo(years),
                      endDate: new Date().toISOString().slice(0, 10),
                    })
                  }
                >
                  近 {years} 年
                </Button>
              ))}
              <span className="text-ink-300">|</span>
              <span>
                不复权收盘价 · 非交易日顺延 · 100 股整数倍 · 佣金万 2.5，最低 5 元 ·
                分红税前口径并回购原标的
              </span>
            </Space>
          </div>
        </Form>
      </div>

      {results.length ? (
        <>
          <div className="workspace-panel px-6 pt-5 pb-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <Text strong className="text-[15px]">资产曲线</Text>
                <Text type="secondary" className="ml-2 text-xs">
                  持仓市值 + 期末现金
                </Text>
              </div>
              <Text type="secondary" className="text-xs">
                数据来自每个结果记录的独立快照
              </Text>
            </div>
            <ReactECharts option={chartOption} style={{ height: 320 }} />
          </div>
          <div className="workspace-panel overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between border-b border-line-soft">
              <Text strong className="text-[15px]">同条件比较</Text>
              <Text type="secondary" className="text-xs">
                点击行查看回测明细
              </Text>
            </div>
            <Table
              rowKey="id"
              pagination={false}
              dataSource={results}
              onRow={(record) => ({
                onClick: () => setDetail(record),
                className: "data-row cursor-pointer",
              })}
              columns={[
                {
                  title: "标的",
                  width: 180,
                  render: (_, row) => (
                    <div>
                      <Text strong>{row.name}</Text>
                      <div className="text-xs text-ink-400 tabular-nums">{row.symbol}</div>
                    </div>
                  ),
                },
                {
                  title: "累计投入",
                  align: "right",
                  className: "tabular-nums",
                  render: (_, row) => money(row.metrics.totalContribution),
                },
                {
                  title: "最终资产",
                  align: "right",
                  className: "tabular-nums",
                  render: (_, row) => money(row.metrics.endingAsset),
                },
                {
                  title: "累计盈亏",
                  align: "right",
                  render: (_, row) => (
                    <Text
                      type={row.metrics.totalPnl >= 0 ? "success" : "danger"}
                      className="tabular-nums"
                    >
                      {money(row.metrics.totalPnl)}
                    </Text>
                  ),
                },
                {
                  title: "XIRR",
                  align: "right",
                  className: "tabular-nums",
                  render: (_, row) => percent(row.metrics.xirr),
                },
                {
                  title: "最大回撤",
                  align: "right",
                  className: "tabular-nums",
                  render: (_, row) => percent(row.metrics.maxDrawdown),
                },
                {
                  title: "累计分红",
                  align: "right",
                  className: "tabular-nums",
                  render: (_, row) => money(row.metrics.totalDividend),
                },
                {
                  title: "期末现金",
                  align: "right",
                  className: "tabular-nums",
                  render: (_, row) => money(row.metrics.endingCash),
                },
              ]}
            />
          </div>
        </>
      ) : (
        <div className="workspace-panel min-h-[320px] flex items-center justify-center">
          <div className="text-center py-10">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-50 text-[24px] text-gold-500">
              <LineChartOutlined />
            </div>
            <Text strong className="text-[15px]">还没有回测结果</Text>
            <div className="mt-1.5 text-[13px] text-ink-400">
              设置参数并开始，结果会自动保存到本地 SQLite。
            </div>
          </div>
        </div>
      )}

      <Drawer
        title={detail ? `${detail.name} · 回测明细` : "回测明细"}
        width={1152}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Tabs
            defaultActiveKey="simple"
            items={[
              {
                key: "simple",
                label: "简化明细（费用 0 · 零碎股）",
                children: (
                  <Space direction="vertical" size="large" className="w-full">
                    <div className="metric-strip grid grid-cols-4 border-y border-line-soft py-4">
                      {[
                        [
                          "实际区间",
                          `${simpleResult?.actualStartDate ?? detail.actualStartDate} — ${
                            simpleResult?.actualEndDate ?? detail.actualEndDate
                          }`,
                        ],
                        [
                          "明细行数",
                          `${simpleResult?.rows.length ?? 0} 条`,
                        ],
                        [
                          "累计投入",
                          money(simpleResult?.endingCost ?? 0),
                        ],
                        [
                          "当前盈亏率",
                          percent(simpleResult?.returnRate ?? null),
                        ],
                      ].map(([label, value]) => (
                        <div key={label} className="px-4 first:pl-0">
                          <div className="metric-label">{label}</div>
                          <Text strong className="tabular-nums">{value}</Text>
                        </div>
                      ))}
                    </div>
                    {simpleQuery.isLoading && (
                      <Text type="secondary">正在加载简化明细…</Text>
                    )}
                    {simpleQuery.isError && (
                      <Tag color="error">
                        加载失败：{simpleQuery.error instanceof Error ? simpleQuery.error.message : "未知错误"}
                      </Tag>
                    )}
                    {simpleResult && (
                      <Table
                        size="small"
                        rowKey={(row, index) => `${row.date}-${row.event}-${index}`}
                        pagination={{ pageSize: 20, showSizeChanger: false }}
                        dataSource={simpleResult.rows}
                        scroll={{ x: 1080 }}
                        columns={[
                          {
                            title: "日期",
                            dataIndex: "date",
                            width: 110,
                            className: "tabular-nums",
                            sorter: (a, b) => a.date.localeCompare(b.date),
                            defaultSortOrder: "ascend",
                            filters: [
                              { text: "2024", value: "2024" },
                              { text: "2025", value: "2025" },
                              { text: "2026", value: "2026" },
                            ],
                            onFilter: (value, row) => row.date.startsWith(String(value)),
                          },
                          {
                            title: "事件",
                            dataIndex: "event",
                            width: 90,
                            render: (event: SimpleBacktestRow["event"]) => (
                              <Tag color={EVENT_COLORS[event]} bordered={false}>
                                {EVENT_LABELS[event]}
                              </Tag>
                            ),
                            filters: [
                              { text: "定投买入", value: "buy" },
                              { text: "分红到账", value: "dividend" },
                              { text: "除权调整", value: "ex_right" },
                            ],
                            onFilter: (value, row) => row.event === value,
                          },
                          {
                            title: "期初现金",
                            dataIndex: "openingCash",
                            width: 110,
                            align: "right",
                            className: "tabular-nums",
                            sorter: (a, b) => a.openingCash - b.openingCash,
                            render: (value: number) => money(value),
                          },
                          {
                            title: "收盘价",
                            dataIndex: "price",
                            width: 90,
                            align: "right",
                            className: "tabular-nums",
                            sorter: (a, b) => a.price - b.price,
                            render: (value: number, row) =>
                              row.event === "ex_right" && row.prevClose != null ? (
                                <Space size={4}>
                                  <Text type="secondary">{row.prevClose.toFixed(2)}</Text>
                                  <span>→</span>
                                  <Text strong>{value.toFixed(2)}</Text>
                                </Space>
                              ) : (
                                value.toFixed(2)
                              ),
                          },
                          {
                            title: "本期买入",
                            dataIndex: "shares",
                            width: 100,
                            align: "right",
                            className: "tabular-nums",
                            sorter: (a, b) => a.shares - b.shares,
                            render: (value: number, row) =>
                              row.event === "buy" ? value.toFixed(2) : "—",
                          },
                          {
                            title: "累计股数",
                            dataIndex: "cumulativeShares",
                            width: 100,
                            align: "right",
                            className: "tabular-nums",
                            sorter: (a, b) => a.cumulativeShares - b.cumulativeShares,
                            render: (value: number) => value.toFixed(2),
                          },
                          {
                            title: "累计投入",
                            dataIndex: "cumulativeCost",
                            width: 110,
                            align: "right",
                            className: "tabular-nums",
                            sorter: (a, b) => a.cumulativeCost - b.cumulativeCost,
                            render: (value: number) => money(value),
                          },
                          {
                            title: "期末现金",
                            dataIndex: "endingCash",
                            width: 110,
                            align: "right",
                            className: "tabular-nums",
                            sorter: (a, b) => a.endingCash - b.endingCash,
                            render: (value: number) => money(value),
                          },
                          {
                            title: "盈亏率",
                            dataIndex: "returnRate",
                            width: 100,
                            align: "right",
                            className: "tabular-nums",
                            sorter: (a, b) => a.returnRate - b.returnRate,
                            render: (value: number) => (
                              <Text type={value >= 0 ? "success" : "danger"}>
                                {percent(value)}
                              </Text>
                            ),
                          },
                          {
                            title: "金额/分红",
                            dataIndex: "amount",
                            width: 110,
                            align: "right",
                            className: "tabular-nums",
                            sorter: (a, b) => a.amount - b.amount,
                            render: (value: number, row) =>
                              row.event === "ex_right" ? (
                                <Text type="secondary">
                                  每股 {row.dividendPerShare?.toFixed(4) ?? "—"}
                                </Text>
                              ) : (
                                money(value)
                              ),
                          },
                        ]}
                      />
                    )}
                    <div className="text-xs text-ink-500">
                      口径：交易费用 0 · 零碎股（2 位小数） · contribution 与 buy 合并行 ·
                      分红到账不再投资 · 除权日仅记录价格变化。
                    </div>
                  </Space>
                ),
              },
              {
                key: "actual",
                label: "实际交易（含费用）",
                children: (
                  <Space direction="vertical" size="large" className="w-full">
                    {detail.warnings.map((warning) => (
                      <Tag key={warning} color="warning">
                        {warning}
                      </Tag>
                    ))}
                    <Table
                      size="small"
                      rowKey={(row, index) => `${row.date}-${row.type}-${index}`}
                      pagination={{ pageSize: 20, showSizeChanger: false }}
                      dataSource={detail.transactions}
                      scroll={{ x: 864 }}
                      columns={[
                        {
                          title: "日期",
                          dataIndex: "date",
                          width: 110,
                          className: "tabular-nums",
                          sorter: (a, b) => a.date.localeCompare(b.date),
                          defaultSortOrder: "ascend",
                        },
                        {
                          title: "类型",
                          dataIndex: "type",
                          width: 120,
                          className: "tabular-nums",
                          filters: [
                            { text: "contribution", value: "contribution" },
                            { text: "buy", value: "buy" },
                            { text: "dividend", value: "dividend" },
                            { text: "dividend_reinvest", value: "dividend_reinvest" },
                            { text: "repo_interest", value: "repo_interest" },
                          ],
                          onFilter: (value, row) => row.type === value,
                        },
                        {
                          title: "数量",
                          dataIndex: "quantity",
                          width: 80,
                          align: "right",
                          className: "tabular-nums",
                          sorter: (a, b) => a.quantity - b.quantity,
                        },
                        {
                          title: "价格",
                          dataIndex: "price",
                          width: 80,
                          align: "right",
                          className: "tabular-nums",
                          sorter: (a, b) => a.price - b.price,
                        },
                        {
                          title: "金额",
                          width: 110,
                          align: "right",
                          className: "tabular-nums",
                          sorter: (a, b) => a.amount - b.amount,
                          render: (_, row) => money(row.amount),
                        },
                        {
                          title: "费用",
                          width: 90,
                          align: "right",
                          className: "tabular-nums",
                          sorter: (a, b) => a.fee - b.fee,
                          render: (_, row) => money(row.fee),
                        },
                        {
                          title: "现金",
                          width: 110,
                          align: "right",
                          className: "tabular-nums",
                          sorter: (a, b) => a.cashAfter - b.cashAfter,
                          render: (_, row) => money(row.cashAfter),
                        },
                      ]}
                    />
                    <div>
                      <Text strong>数据来源</Text>
                      {detail.provenance.map((item) => (
                        <div key={item.source} className="mt-2 text-xs text-ink-500">
                          {item.source} · 截止 {item.dataCutoff} · 获取 {item.fetchedAt}
                        </div>
                      ))}
                    </div>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
