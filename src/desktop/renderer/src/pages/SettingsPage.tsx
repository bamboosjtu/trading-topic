import { useState } from "react";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DatabaseOutlined,
  DownloadOutlined,
  FileTextOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type DataSourceHealthItem,
  type DataSourceHealthStatus,
  type DirectoryProvenance,
  type MarketCalendarDiagnostic,
  type SecurityTradingInterruption,
} from "../api/client";
import { beijingTimestamp } from "./_shared/format";

function fetchedAt(value: string): string {
  return beijingTimestamp(value);
}

function DirectoryDetails({
  title,
  value,
}: {
  title: string;
  value: DirectoryProvenance | null | undefined;
}) {
  return (
    <section className="settings-source-card">
      <div className="settings-source-heading">
        <strong>{title}</strong>
        {value ? (
          <Tag color={value.fallbackUsed ? "gold" : "green"}>
            {value.fallbackUsed ? "已使用兜底源" : "主源成功"}
          </Tag>
        ) : (
          <Tag>尚无本地快照</Tag>
        )}
      </div>
      {value ? (
        <Descriptions size="small" column={1} colon={false}>
          <Descriptions.Item label="实际来源">
            {value.source}
          </Descriptions.Item>
          <Descriptions.Item label="约定主源">
            {value.primarySource}
          </Descriptions.Item>
          {value.fallbackUsed ? (
            <Descriptions.Item label="兜底原因">
              {value.fallbackReason ?? "未记录原因"}
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label="获取时间">
            <span className="tabular-nums">{fetchedAt(value.fetchedAt)}</span>
          </Descriptions.Item>
        </Descriptions>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="首次加载证券目录后显示实际来源"
        />
      )}
    </section>
  );
}

const SOURCE_HEALTH_LABELS: Record<
  DataSourceHealthStatus,
  { color: "green" | "gold" | "red"; label: string }
> = {
  available: { color: "green", label: "可用" },
  degraded: { color: "gold", label: "已降级" },
  unavailable: { color: "red", label: "不可用" },
};

function DataSourceHealthSection() {
  const sourceHealth = useQuery({
    queryKey: ["data-source-health"],
    queryFn: api.checkDataSources,
    enabled: false,
    retry: false,
    staleTime: 5 * 60 * 1_000,
  });
  const report = sourceHealth.data;
  const summary = report ? SOURCE_HEALTH_LABELS[report.status] : null;
  const columns: ColumnsType<DataSourceHealthItem> = [
    {
      title: "能力",
      dataIndex: "capability",
      width: 150,
    },
    {
      title: "固定路由",
      dataIndex: "route",
      width: 230,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: DataSourceHealthStatus) => {
        const status = SOURCE_HEALTH_LABELS[value];
        return <Tag color={status.color}>{status.label}</Tag>;
      },
    },
    {
      title: "本次来源",
      dataIndex: "source",
      width: 250,
    },
    {
      title: "检查结果",
      render: (_: unknown, value: DataSourceHealthItem) => (
        <div>
          <div>{value.detail}</div>
          {value.fallbackReason ? (
            <div>主源失败：{value.fallbackReason}</div>
          ) : null}
          <span className="tabular-nums">{value.latencyMs} ms</span>
        </div>
      ),
    },
  ];

  return (
    <section className="workspace-panel settings-section">
      <div className="settings-section-title">
        <ReloadOutlined />
        <div>
          <h2>数据源实时可用性</h2>
          <p>产品路由按业务语义固定，备用源自动整段切换；这里做一次性联网探测，不改写目录、行情或公司行动缓存。</p>
        </div>
      </div>
      <Alert
        className="mb-4"
        type="info"
        showIcon
        message="不开放任意主备顺序切换"
        description="ETF 目录固定使用新浪；停复牌分别检查东方财富市场级主源和百度独立备用源。设置页展示每个来源的当次健康、固定路由和兜底原因，不用手工开关绕过完整性门槛。"
      />
      <div className="settings-actions mb-4">
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={sourceHealth.isFetching}
          onClick={() => void sourceHealth.refetch()}
        >
          检查全部数据源
        </Button>
      </div>
      {sourceHealth.error ? (
        <Alert
          type="error"
          showIcon
          message="数据源检查未完成"
          description={sourceHealth.error.message}
        />
      ) : report && summary ? (
        <>
          <Alert
            className="mb-4"
            type={
              report.status === "available"
                ? "success"
                : report.status === "degraded"
                  ? "warning"
                  : "error"
            }
            showIcon
            message={`当次检查：${summary.label}`}
            description={`检查时间 ${fetchedAt(report.checkedAt)}；结果只代表这一次请求。`}
          />
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            scroll={{ x: 980 }}
            columns={columns}
            dataSource={report.items}
          />
        </>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="尚未执行实时检查；本地最近成功来源仍显示在上方目录卡片中"
        />
      )}
    </section>
  );
}

const INTERRUPTION_REASON_LABELS: Record<
  SecurityTradingInterruption["reason"],
  string
> = {
  suspension: "停牌",
  delisted: "退市",
  not_yet_listed: "未上市",
};

function TradingInterruptionSection() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: interruptions = [] } = useQuery({
    queryKey: ["trading-interruptions"],
    queryFn: () => api.listTradingInterruptions(),
  });

  const addMutation = useMutation({
    mutationFn: api.addTradingInterruption,
    onSuccess: async () => {
      message.success("停牌证据已添加");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["trading-interruptions"],
      });
    },
    onError: (error) => message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteTradingInterruption,
    onSuccess: async () => {
      message.success("停牌证据已删除");
      await queryClient.invalidateQueries({
        queryKey: ["trading-interruptions"],
      });
    },
    onError: (error) => message.error(error.message),
  });

  const columns: ColumnsType<SecurityTradingInterruption> = [
    {
      title: "证券代码",
      dataIndex: "symbol",
      width: 110,
      render: (v: string) => <span className="tabular-nums">{v}</span>,
    },
    {
      title: "起始日",
      dataIndex: "startDate",
      width: 120,
    },
    {
      title: "结束日",
      dataIndex: "endDate",
      width: 120,
    },
    {
      title: "原因",
      dataIndex: "reason",
      width: 90,
      render: (v: SecurityTradingInterruption["reason"]) => (
        <Tag>{INTERRUPTION_REASON_LABELS[v]}</Tag>
      ),
    },
    { title: "来源", dataIndex: "source" },
    {
      title: "操作",
      width: 80,
      render: (_: unknown, record: SecurityTradingInterruption) => (
        <Popconfirm
          title="确认删除这条停牌证据？"
          onConfirm={() =>
            deleteMutation.mutate({
              symbol: record.symbol,
              startDate: record.startDate,
              endDate: record.endDate,
              reason: record.reason,
            })
          }
        >
          <Button type="link" danger size="small">
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      addMutation.mutate({
        symbol: values.symbol,
        startDate: values.dateRange[0].format("YYYY-MM-DD"),
        endDate: values.dateRange[1].format("YYYY-MM-DD"),
        reason: values.reason,
        source: values.source,
        sourceId: values.sourceId || undefined,
      });
    });
  };

  return (
    <section className="workspace-panel settings-section">
      <div className="settings-section-title">
        <PauseCircleOutlined />
        <div>
          <h2>证券级停复牌证据</h2>
          <p>
            回测和持仓行情刷新会先尝试自动同步停复牌；这里仅用于公司或交易所公告的人工补证与纠错，自动源状态请查看上方实时检查。
          </p>
        </div>
      </div>
      <div className="settings-actions">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
        >
          添加人工补充证据
        </Button>
      </div>
      <Table
        rowKey={(r) => `${r.symbol}-${r.startDate}-${r.endDate}-${r.reason}`}
        size="small"
        pagination={false}
        columns={columns}
        dataSource={interruptions}
        locale={{ emptyText: "暂无停牌证据" }}
      />
      <Modal
        title="添加停牌证据"
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={addMutation.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="symbol"
            label="证券代码"
            rules={[
              { required: true, pattern: /^\d{6}$/, message: "请输入 6 位证券代码" },
            ]}
          >
            <Input placeholder="如 601088" />
          </Form.Item>
          <Form.Item
            name="dateRange"
            label="停牌区间（含首尾，复牌日不在内）"
            rules={[{ required: true, message: "请选择停牌区间" }]}
          >
            <DatePicker.RangePicker />
          </Form.Item>
          <Form.Item
            name="reason"
            label="原因"
            rules={[{ required: true, message: "请选择原因" }]}
          >
            <Select placeholder="选择不交易原因">
              <Select.Option value="suspension">停牌</Select.Option>
              <Select.Option value="delisted">退市</Select.Option>
              <Select.Option value="not_yet_listed">未上市</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="source"
            label="证据来源"
            rules={[{ required: true, message: "请填写来源" }]}
          >
            <Input placeholder="如 eastmoney_announcement" />
          </Form.Item>
          <Form.Item name="sourceId" label="来源 ID（可选）">
            <Input placeholder="公告或记录 ID" />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

export function SettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });
  const diagnostics = useQuery({
    queryKey: ["diagnostics"],
    queryFn: api.getDiagnostics,
  });

  const exportBackup = useMutation({
    mutationFn: api.exportBackup,
    onSuccess: (result) => {
      if (!result.cancelled) message.success("当前 Schema 的 JSON 备份已导出");
    },
    onError: (error) => message.error(error.message),
  });
  const restoreBackup = useMutation({
    mutationFn: api.restoreBackup,
    onSuccess: async (result) => {
      if (result.cancelled) return;
      await queryClient.invalidateQueries();
      message.success(
        result.safetyBackupPath
          ? `恢复完成；恢复前安全备份已保存到 ${result.safetyBackupPath}`
          : "恢复完成",
      );
    },
    onError: (error) => message.error(error.message),
  });
  const exportLogs = useMutation({
    mutationFn: api.exportLogs,
    onSuccess: (result) => {
      if (!result.cancelled) message.success("脱敏运行日志已导出");
    },
    onError: (error) => message.error(error.message),
  });

  const loading =
    health.isLoading || settings.isLoading || diagnostics.isLoading;
  const queryError = health.error ?? settings.error ?? diagnostics.error;
  const pendingCalendars =
    diagnostics.data?.marketCalendars.filter(
      (calendar) => calendar.status === "pending_official_schedule",
    ) ?? [];
  const calendarColumns: ColumnsType<MarketCalendarDiagnostic> = [
    {
      title: "年度",
      dataIndex: "year",
      width: 100,
      render: (value: number) => (
        <span className="tabular-nums">{value}</span>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 180,
      render: (value: MarketCalendarDiagnostic["status"]) =>
        value === "official" ? (
          <Tag color="green">官方安排</Tag>
        ) : (
          <Tag color="gold">等待官方安排</Tag>
        ),
    },
    {
      title: "来源",
      dataIndex: "source",
      render: (value: string | null) => value ?? "尚未发布，不猜测休市日",
    },
  ];

  return (
    <div className="settings-page">
      <header className="page-heading">
        <h1>本地设置</h1>
        <p>查看固定产品口径、数据源实时健康、交易日历，并维护本机数据。</p>
      </header>

      {queryError ? (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          message="无法读取本地诊断"
          description={queryError.message}
        />
      ) : null}
      {pendingCalendars.length ? (
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          message={`${pendingCalendars.map((item) => item.year).join("、")} 年交易日历等待官方安排`}
          description="这些年度不会猜测工作日休市。正式安排发布后必须更新年度 JSON；在此之前，相关尾部可能保持 partial，且该年度成为当前年度时应用会拒绝启动发布版本。"
        />
      ) : null}

      {loading ? (
        <section className="workspace-panel settings-loading">
          <Skeleton active paragraph={{ rows: 8 }} />
        </section>
      ) : (
        <>
          <section className="workspace-panel settings-section">
            <div className="settings-section-title">
              <SafetyCertificateOutlined />
              <div>
                <h2>应用与计算口径</h2>
                <p>R1 固定口径只读展示，不在设置页临时改写。</p>
              </div>
            </div>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="应用版本">
                {health.data?.version ?? "—"}
              </Descriptions.Item>
              <Descriptions.Item label="数据库 Schema">
                <Tag color="blue">
                  Schema {diagnostics.data?.schemaVersion ?? "—"}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="价格来源">
                腾讯主源 / 新浪整段兜底
              </Descriptions.Item>
              <Descriptions.Item label="分红来源">
                东方财富公司行动
              </Descriptions.Item>
              <Descriptions.Item label="佣金率">
                {settings.data?.commissionRate === 0
                  ? "0（R1 固定）"
                  : settings.data?.commissionRate}
              </Descriptions.Item>
              <Descriptions.Item label="最低佣金">
                {settings.data?.minimumCommission === 0
                  ? "¥0（R1 固定）"
                  : `¥${settings.data?.minimumCommission ?? "—"}`}
              </Descriptions.Item>
              <Descriptions.Item label="计算口径版本" span={2}>
                <span className="tabular-nums">
                  {settings.data?.caliberVersion ?? "—"}
                </span>
              </Descriptions.Item>
            </Descriptions>
          </section>

          <DataSourceHealthSection />

          <section className="workspace-panel settings-section">
            <div className="settings-section-title">
              <DatabaseOutlined />
              <div>
                <h2>证券目录来源</h2>
                <p>显示最近一次成功写入 SQLite 的实际来源和兜底原因。</p>
              </div>
            </div>
            <div className="settings-source-grid">
              <DirectoryDetails
                title="A 股目录"
                value={diagnostics.data?.stockDirectory}
              />
              <DirectoryDetails
                title="境内 ETF 目录"
                value={diagnostics.data?.etfDirectory}
              />
            </div>
          </section>

          <section className="workspace-panel settings-section">
            <div className="settings-section-title">
              <FileTextOutlined />
              <div>
                <h2>年度交易日历</h2>
                <p>只有 official 年度可证明工作日法定休市。</p>
              </div>
            </div>
            <Table
              rowKey="year"
              size="small"
              pagination={false}
              columns={calendarColumns}
              dataSource={diagnostics.data?.marketCalendars ?? []}
            />
          </section>

          <TradingInterruptionSection />

          <section className="workspace-panel settings-section">
            <div className="settings-section-title">
              <DatabaseOutlined />
              <div>
                <h2>本机数据维护</h2>
                <p>
                  仅接受当前 Schema 1 备份；旧数据库和旧备份不会迁移或补默认值。
                </p>
              </div>
            </div>
            <Alert
              className="mb-4"
              type="info"
              showIcon
              message="恢复会先生成安全备份，再覆盖当前流水、实验、行情缓存和目录快照。"
            />
            <div className="settings-actions">
              <Button
                icon={<DownloadOutlined />}
                loading={exportBackup.isPending}
                onClick={() => exportBackup.mutate()}
              >
                导出 JSON 备份
              </Button>
              <Button
                danger
                icon={<UploadOutlined />}
                loading={restoreBackup.isPending}
                onClick={() => restoreBackup.mutate()}
              >
                从当前版本备份恢复
              </Button>
              <Button
                icon={<FileTextOutlined />}
                loading={exportLogs.isPending}
                onClick={() => exportLogs.mutate()}
              >
                导出脱敏日志
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
