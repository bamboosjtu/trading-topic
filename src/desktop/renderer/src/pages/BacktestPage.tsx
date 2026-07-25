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
  Tag,
  Typography,
} from "antd";
import { PlayCircleOutlined, HistoryOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { api, type BacktestRequest, type BacktestResult } from "../api/client";

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

function dateYearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function money(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number | null): string {
  return value === null ? "不可计算" : `${(value * 100).toFixed(2)}%`;
}

export function BacktestPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<BacktestRequest>();
  const [currentResults, setCurrentResults] = useState<BacktestResult[]>([]);
  const [detail, setDetail] = useState<BacktestResult | null>(null);
  const history = useQuery({
    queryKey: ["backtests"],
    queryFn: api.listBacktests,
  });
  const mutation = useMutation({
    mutationFn: api.runBacktest,
    onSuccess: (results) => {
      setCurrentResults(results);
      void queryClient.invalidateQueries({ queryKey: ["backtests"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      message.success(`已完成 ${results.length} 个标的回测`);
    },
    onError: (error) => message.error(error.message),
  });
  const results = currentResults.length ? currentResults : history.data?.slice(0, 4) ?? [];

  const chartOption = useMemo(
    () => ({
      animationDuration: 500,
      tooltip: { trigger: "axis", valueFormatter: (value: number) => money(value) },
      grid: { left: 20, right: 24, top: 32, bottom: 20, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: "#52636e" } },
      xAxis: {
        type: "category",
        data: results[0]?.equityCurve.map((row) => row.date) ?? [],
        axisLabel: { hideOverlap: true, color: "#7b8991" },
        axisLine: { lineStyle: { color: "#dfe5e8" } },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: "#7b8991",
          formatter: (value: number) => `${Math.round(value / 10_000)}万`,
        },
        splitLine: { lineStyle: { color: "#edf0f2" } },
      },
      series: results.map((result) => ({
        name: result.name,
        type: "line",
        showSymbol: false,
        smooth: 0.12,
        data: result.equityCurve.map((row) => row.asset),
        lineStyle: { width: 2 },
      })),
      color: ["#b88746", "#315f78", "#2d7650", "#8b5b70"],
    }),
    [results],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <Text className="text-xs tracking-[0.18em] uppercase !text-[#8a6a3e]">
            Historical simulation
          </Text>
          <Title level={2} className="!mt-1 !mb-1 !text-[26px]">
            历史回测
          </Title>
          <Text type="secondary">
            固定金额、整数手、现金结转与现金分红回购；同一条件最多并排 4 个 A 股。
          </Text>
        </div>
        <Tag icon={<HistoryOutlined />} bordered={false}>
          已保存 {history.data?.length ?? 0} 次结果
        </Tag>
      </div>

      <div className="workspace-panel p-5">
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
              />
            </Form.Item>
            <Form.Item name="startDate" label="开始日期" className="!mb-0">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="endDate" label="结束日期" className="!mb-0">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="monthlyAmount" label="每月投入" className="!mb-0">
              <InputNumber min={100} step={500} suffix="元" className="w-full" />
            </Form.Item>
            <Form.Item name="buyDay" label="指定买入日" className="!mb-0">
              <InputNumber min={1} max={28} suffix="日" className="w-full" />
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
          <div className="mt-4 pt-4 border-t border-[#edf0f2] text-xs text-[#6c7b84]">
            <Space size={8} wrap>
              <span>快捷区间：</span>
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
              <span className="text-[#b4bdc2]">|</span>
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
          <div className="workspace-panel px-5 pt-5 pb-2">
            <div className="flex items-center justify-between mb-3">
              <div>
                <Text strong>资产曲线</Text>
                <Text type="secondary" className="ml-2 text-xs">
                  持仓市值 + 期末现金
                </Text>
              </div>
              <Text type="secondary" className="text-xs">
                数据来自每个结果记录的独立快照
              </Text>
            </div>
            <ReactECharts option={chartOption} style={{ height: 310 }} />
          </div>
          <div className="workspace-panel overflow-hidden">
            <div className="px-5 py-4 border-b border-[#edf0f2]">
              <Text strong>同条件比较</Text>
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
                  render: (_, row) => (
                    <div>
                      <Text strong>{row.name}</Text>
                      <div className="text-xs text-[#7b8991]">{row.symbol}</div>
                    </div>
                  ),
                },
                { title: "累计投入", render: (_, row) => money(row.metrics.totalContribution) },
                { title: "最终资产", render: (_, row) => money(row.metrics.endingAsset) },
                {
                  title: "累计盈亏",
                  render: (_, row) => (
                    <Text type={row.metrics.totalPnl >= 0 ? "success" : "danger"}>
                      {money(row.metrics.totalPnl)}
                    </Text>
                  ),
                },
                { title: "XIRR", render: (_, row) => percent(row.metrics.xirr) },
                { title: "最大回撤", render: (_, row) => percent(row.metrics.maxDrawdown) },
                { title: "累计分红", render: (_, row) => money(row.metrics.totalDividend) },
                { title: "期末现金", render: (_, row) => money(row.metrics.endingCash) },
              ]}
            />
          </div>
        </>
      ) : (
        <div className="workspace-panel min-h-[300px] flex items-center justify-center">
          <div className="text-center">
            <div className="text-[40px] text-[#cad2d7]">∿</div>
            <Text strong>还没有回测结果</Text>
            <div className="mt-1 text-sm text-[#7b8991]">
              设置参数并开始，结果会自动保存到本地 SQLite。
            </div>
          </div>
        </div>
      )}

      <Drawer
        title={detail ? `${detail.name} · 回测明细` : "回测明细"}
        width={720}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Space direction="vertical" size="large" className="w-full">
            <div className="metric-strip grid grid-cols-3 border-y border-[#e4e9ec] py-4">
              {[
                ["实际区间", `${detail.actualStartDate} — ${detail.actualEndDate}`],
                ["交易记录", `${detail.transactions.length} 条`],
                ["告警", `${detail.warnings.length} 条`],
              ].map(([label, value]) => (
                <div key={label} className="px-4 first:pl-0">
                  <div className="metric-label">{label}</div>
                  <Text strong>{value}</Text>
                </div>
              ))}
            </div>
            {detail.warnings.map((warning) => (
              <Tag key={warning} color="warning">
                {warning}
              </Tag>
            ))}
            <Table
              size="small"
              rowKey={(row, index) => `${row.date}-${row.type}-${index}`}
              pagination={{ pageSize: 10 }}
              dataSource={detail.transactions}
              columns={[
                { title: "日期", dataIndex: "date" },
                { title: "类型", dataIndex: "type" },
                { title: "数量", dataIndex: "quantity" },
                { title: "价格", dataIndex: "price" },
                { title: "金额", render: (_, row) => money(row.amount) },
                { title: "费用", render: (_, row) => money(row.fee) },
                { title: "现金", render: (_, row) => money(row.cashAfter) },
              ]}
            />
            <div>
              <Text strong>数据来源</Text>
              {detail.provenance.map((item) => (
                <div key={item.source} className="mt-2 text-xs text-[#6c7b84]">
                  {item.source} · 截止 {item.dataCutoff} · 获取 {item.fetchedAt}
                </div>
              ))}
            </div>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
