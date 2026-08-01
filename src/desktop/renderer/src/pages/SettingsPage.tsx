import {
  Alert,
  App,
  Button,
  Descriptions,
  Empty,
  Skeleton,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DatabaseOutlined,
  DownloadOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type DirectoryProvenance,
  type MarketCalendarDiagnostic,
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
        <p>查看固定产品口径、数据来源与交易日历，并维护本机数据。</p>
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

          <section className="workspace-panel settings-section">
            <div className="settings-section-title">
              <DatabaseOutlined />
              <div>
                <h2>本机数据维护</h2>
                <p>
                  仅接受当前 Schema 2 备份；旧数据库和旧备份不会迁移或补默认值。
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
