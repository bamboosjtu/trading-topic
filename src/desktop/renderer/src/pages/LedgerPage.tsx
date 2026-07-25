import {
  Card,
  Typography,
  Empty,
  Button,
  Space,
  Dropdown,
  Tag,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";

const { Title, Text } = Typography;

const ENTRY_TYPES: MenuProps["items"] = [
  { key: "transfer-in", label: "资金转入" },
  { key: "buy", label: "买入" },
  { key: "sell", label: "卖出" },
  { key: "dividend", label: "现金分红" },
  { key: "reverse-repo", label: "国债逆回购" },
  { key: "transfer-out", label: "资金转出" },
  { type: "divider" },
  { key: "adjustment", label: "冲正 / 修正" },
];

export function LedgerPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Title level={4} className="!mb-1">
            流水
          </Title>
          <Text type="secondary" className="text-sm">
            追加式记录：已参与计算的记录不原地覆盖，冲正创建反向记录
          </Text>
        </div>
        <Dropdown menu={{ items: ENTRY_TYPES }} placement="bottomRight">
          <Button type="primary" icon={<PlusOutlined />}>
            新增流水
          </Button>
        </Dropdown>
      </div>

      <Card>
        <Empty
          description={
            <Space direction="vertical" size={4}>
              <Text>暂无流水记录</Text>
              <Text type="secondary" className="text-xs">
                点击右上角「新增流水」录入资金转入、买入、卖出等记录
              </Text>
            </Space>
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Card>

      <Card size="small" title="流水类型说明">
        <div className="grid grid-cols-2 gap-3 text-sm text-ink-600">
          <div>
            <Tag color="green">资金转入</Tag>
            <span>外部资金进入账户</span>
          </div>
          <div>
            <Tag color="red">资金转出</Tag>
            <span>资金离开账户</span>
          </div>
          <div>
            <Tag color="blue">买入 / 卖出</Tag>
            <span>股票交易，按 100 股整数倍</span>
          </div>
          <div>
            <Tag color="purple">现金分红</Tag>
            <span>按登记日持股计算</span>
          </div>
          <div>
            <Tag color="orange">国债逆回购</Tag>
            <span>未到期本金计入总资产，不计入可用现金</span>
          </div>
          <div>
            <Tag color="default">冲正 / 修正</Tag>
            <span>不修改原记录，保留关联关系</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
