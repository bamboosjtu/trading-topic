import { Card, Typography, Empty, Button, Space, Tag } from "antd";
import { PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

const { Title, Paragraph, Text } = Typography;

export function BacktestPage() {
  const { data: health, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
  });

  return (
    <div className="space-y-6">
      {/* 标题区 */}
      <div className="flex items-start justify-between">
        <div>
          <Title level={4} className="!mb-1">
            历史回测
          </Title>
          <Text type="secondary" className="text-sm">
            按固定金额持续买入 A 股股票，验证长期攒股方案的历史表现
          </Text>
        </div>
        <Space>
          <Button icon={<ThunderboltOutlined />}>快捷区间</Button>
          <Button type="primary" icon={<PlusOutlined />}>
            新建回测
          </Button>
        </Space>
      </div>

      {/* Sidecar 连接状态 */}
      <Card size="small" className="!bg-ink-50" styles={{ body: { padding: 12 } }}>
        <Space size="middle">
          <Tag color={isLoading ? "default" : health?.status === "ok" ? "green" : "red"}>
            {isLoading
              ? "连接中..."
              : health?.status === "ok"
                ? "Sidecar 已连接"
                : "Sidecar 异常"}
          </Tag>
          {health?.version && (
            <Text type="secondary" className="text-xs">
              版本 {health.version}
            </Text>
          )}
          {health?.data_cutoff && (
            <Text type="secondary" className="text-xs">
              数据截止 {health.data_cutoff}
            </Text>
          )}
        </Space>
      </Card>

      {/* 回测列表占位 */}
      <Card>
        <Empty
          description="暂无回测记录。点击右上角「新建回测」开始"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Card>

      {/* 口径说明（PRD §6 要求：费用口径必须显示在结果页） */}
      <Card size="small" title="R1 默认口径">
        <Paragraph className="!mb-0 text-sm text-ink-600">
          每月固定金额 · 指定买入日 · 非交易日顺延 · 100 股整数倍买入 ·
          剩余现金结转 · 佣金万分之 2.5（最低 5 元）· 分红按登记日持股计算并回购原标的
        </Paragraph>
      </Card>
    </div>
  );
}
