import { Card, Row, Col, Typography, Empty, Statistic } from "antd";
import {
  WalletOutlined,
  BankOutlined,
  FundOutlined,
  DollarOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;

const PLACEHOLDER_STATS = [
  {
    key: "total-assets",
    title: "总资产",
    value: "—",
    prefix: <DollarOutlined />,
    suffix: "CNY",
  },
  {
    key: "market-value",
    title: "持仓市值",
    value: "—",
    prefix: <FundOutlined />,
    suffix: "CNY",
  },
  {
    key: "cash",
    title: "可用现金",
    value: "—",
    prefix: <WalletOutlined />,
    suffix: "CNY",
  },
  {
    key: "reverse-repo",
    title: "逆回购资产",
    value: "—",
    prefix: <BankOutlined />,
    suffix: "CNY",
  },
];

export function AccountPage() {
  return (
    <div className="space-y-6">
      <div>
        <Title level={4} className="!mb-1">
          账户
        </Title>
        <Text type="secondary" className="text-sm">
          当前持仓、现金、总资产与累计盈亏均从有效流水重算
        </Text>
      </div>

      {/* 概览卡片（占位） */}
      <Row gutter={[16, 16]}>
        {PLACEHOLDER_STATS.map((stat) => (
          <Col xs={12} md={6} key={stat.key}>
            <Card>
              <Statistic
                title={stat.title}
                value={stat.value}
                prefix={stat.prefix}
                suffix={stat.suffix}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="累计盈亏与 XIRR" extra={<Text type="secondary" className="text-xs">尚未实现</Text>}>
            <Empty
              description="尚未接入流水计算"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="持仓明细" extra={<Text type="secondary" className="text-xs">尚未实现</Text>}>
            <Empty
              description="无有效买入流水"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
