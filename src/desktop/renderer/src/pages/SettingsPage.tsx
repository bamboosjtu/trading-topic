import {
  App,
  Button,
  Descriptions,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  DownloadOutlined,
  UploadOutlined,
  FileTextOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

const { Title, Text, Paragraph } = Typography;

export function SettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const exportBackup = useMutation({
    mutationFn: api.exportBackup,
    onSuccess: (result) => {
      if (!result.cancelled) message.success(`备份已保存到 ${result.path}`);
    },
    onError: (error) => message.error(error.message),
  });
  const restore = useMutation({
    mutationFn: api.restoreBackup,
    onSuccess: (result) => {
      if (!result.cancelled) {
        message.success("恢复完成，当前数据已重新载入");
        void queryClient.invalidateQueries();
      }
    },
    onError: (error) => message.error(error.message),
  });
  const exportLogs = useMutation({
    mutationFn: api.exportLogs,
    onSuccess: (result) => {
      if (!result.cancelled) message.success(`日志已保存到 ${result.path}`);
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <Text className="text-xs tracking-[0.18em] uppercase !text-[#8a6a3e]">
          Local control
        </Text>
        <Title level={2} className="!mt-1 !mb-1 !text-[26px]">
          本地设置
        </Title>
        <Text type="secondary">查看固定口径，管理本地 SQLite、备份与运行日志。</Text>
      </div>

      <div className="workspace-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <Space>
            <DatabaseOutlined className="text-[#b88746]" />
            <Text strong>数据与计算口径</Text>
          </Space>
          <Tag bordered={false} color={health.data ? "success" : "default"}>
            {health.data ? "本地服务正常" : "检查中"}
          </Tag>
        </div>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="本地存储">SQLite（sql.js）</Descriptions.Item>
          <Descriptions.Item label="行情截止">
            {health.data?.dataCutoff ?? "尚无快照"}
          </Descriptions.Item>
          <Descriptions.Item label="行情主源">
            腾讯财经 · 不复权日线
          </Descriptions.Item>
          <Descriptions.Item label="分红补充源">
            东方财富 · 已实施税前现金分红
          </Descriptions.Item>
          <Descriptions.Item label="佣金">
            万分之 {(settings.data?.commissionRate ?? 0.00025) * 10_000}，最低{" "}
            {settings.data?.minimumCommission ?? 5} 元
          </Descriptions.Item>
          <Descriptions.Item label="口径版本">
            {settings.data?.caliberVersion ?? "bank-dca-r1-node-v1"}
          </Descriptions.Item>
        </Descriptions>
        <Paragraph type="secondary" className="!mb-0 !mt-4 text-xs">
          R1 不计卖出印花税、分红税、过户费与滑点；期末资产按市值估算，不扣期末卖出费用。
        </Paragraph>
      </div>

      <div className="workspace-panel divide-y divide-[#edf0f2]">
        {[
          {
            title: "导出 JSON 备份",
            detail: "包含 schema 版本、流水、回测结果与必要设置。",
            icon: <DownloadOutlined />,
            action: () => exportBackup.mutate(),
            loading: exportBackup.isPending,
            label: "导出",
          },
          {
            title: "从 JSON 恢复",
            detail: "校验成功后先生成当前数据的安全备份，再确认覆盖。",
            icon: <UploadOutlined />,
            action: () => restore.mutate(),
            loading: restore.isPending,
            label: "选择文件",
          },
          {
            title: "导出运行日志",
            detail: "导出启动、回测和数据操作日志；会过滤令牌与敏感字段。",
            icon: <FileTextOutlined />,
            action: () => exportLogs.mutate(),
            loading: exportLogs.isPending,
            label: "导出日志",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="data-row flex items-center justify-between px-5 py-5"
          >
            <div>
              <Text strong>{item.title}</Text>
              <div className="mt-1 text-xs text-[#6c7b84]">{item.detail}</div>
            </div>
            <Button icon={item.icon} onClick={item.action} loading={item.loading}>
              {item.label}
            </Button>
          </div>
        ))}
      </div>

      <div className="px-1 text-xs text-[#7b8991]">
        仅供研究与记录，不构成投资建议。应用不连接券商、不申请交易权限、不执行下单。
      </div>
    </div>
  );
}
