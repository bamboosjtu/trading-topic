import {
  Card,
  Typography,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Divider,
  Space,
  Tag,
} from "antd";
import { DownloadOutlined, UploadOutlined, FileTextOutlined } from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;

export function SettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Title level={4} className="!mb-1">
          设置
        </Title>
        <Text type="secondary" className="text-sm">
          数据来源、费用口径、JSON 备份恢复与日志导出
        </Text>
      </div>

      {/* 数据来源 */}
      <Card title="数据来源" extra={<Tag color="default">R1 仅 A 股</Tag>}>
        <Form layout="vertical" disabled>
          <Form.Item label="行情主源" tooltip="R1 由 sidecar 配置，UI 暂为只读">
            <Select
              defaultValue="tencent"
              options={[
                { value: "tencent", label: "腾讯财经（stock_zh_a_hist_tx）" },
                { value: "sina", label: "新浪财经（stock_zh_a_daily）" },
              ]}
            />
          </Form.Item>
          <Form.Item label="分红主源">
            <Select
              defaultValue="sina"
              options={[
                { value: "sina", label: "新浪财经（stock_history_dividend_detail）" },
                { value: "em", label: "东方财富（stock_fhps_detail_em）" },
              ]}
            />
          </Form.Item>
          <Form.Item label="数据截止时间">
            <Input placeholder="由 sidecar 在每次计算时记录" disabled />
          </Form.Item>
        </Form>
      </Card>

      {/* 费用口径（PRD §3.1 简化费用） */}
      <Card title="费用口径" extra={<Tag color="default">R1 单一模式</Tag>}>
        <Form layout="vertical" disabled>
          <Form.Item label="买入佣金费率">
            <InputNumber
              defaultValue={0.00025}
              min={0}
              step={0.00005}
              addonAfter="万分之"
              className="w-full"
            />
          </Form.Item>
          <Form.Item label="最低佣金">
            <InputNumber defaultValue={5} min={0} addonAfter="元" className="w-full" />
          </Form.Item>
          <Paragraph type="secondary" className="!mb-0 text-xs">
            R1 不计卖出印花税、分红税、过户费与滑点；期末资产按市值估算，不扣期末卖出费用。
          </Paragraph>
        </Form>
      </Card>

      {/* 备份与导入 */}
      <Card title="备份与恢复">
        <Space direction="vertical" size="middle" className="w-full">
          <div className="flex items-center justify-between">
            <div>
              <Text strong>导出 JSON 备份</Text>
              <br />
              <Text type="secondary" className="text-xs">
                包含 schema 版本、导出时间、业务数据与必要元数据
              </Text>
            </div>
            <Button icon={<DownloadOutlined />}>导出</Button>
          </div>
          <Divider className="!my-2" />
          <div className="flex items-center justify-between">
            <div>
              <Text strong>从 JSON 恢复</Text>
              <br />
              <Text type="secondary" className="text-xs">
                导入前完成结构校验与版本检查，先生成当前数据备份
              </Text>
            </div>
            <Button icon={<UploadOutlined />}>选择文件</Button>
          </div>
          <Divider className="!my-2" />
          <div className="flex items-center justify-between">
            <div>
              <Text strong>导出运行日志</Text>
              <br />
              <Text type="secondary" className="text-xs">
                不含 Token、Cookie、账号或个人敏感信息
              </Text>
            </div>
            <Button icon={<FileTextOutlined />}>导出日志</Button>
          </div>
        </Space>
      </Card>
    </div>
  );
}
