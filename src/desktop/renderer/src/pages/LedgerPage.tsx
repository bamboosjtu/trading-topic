import { useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined, RollbackOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type EntryType,
  type LedgerEntryInput,
} from "../api/client";

const { Title, Text } = Typography;
const LABELS: Record<EntryType, string> = {
  transfer_in: "资金转入",
  buy: "买入",
  sell: "卖出",
  dividend: "现金分红",
  reverse_repo: "国债逆回购",
  transfer_out: "资金转出",
  adjustment: "冲正 / 修正",
};
const ENTRY_OPTIONS = Object.entries(LABELS)
  .filter(([value]) => value !== "adjustment")
  .map(([value, label]) => ({ value, label }));
const money = (value?: number) =>
  value === undefined
    ? "—"
    : new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: "CNY",
      }).format(value);

export function LedgerPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<LedgerEntryInput>();
  const entryType = Form.useWatch("type", form);
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: api.listLedger });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    void queryClient.invalidateQueries({ queryKey: ["account"] });
  };
  const addMutation = useMutation({
    mutationFn: api.addLedger,
    onSuccess: () => {
      message.success("流水已追加");
      setOpen(false);
      form.resetFields();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const reverseMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.reverseLedger(id, "用户手工冲正"),
    onSuccess: () => {
      message.success("已创建冲正记录，原记录保持不变");
      refresh();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <Text className="text-xs tracking-[0.18em] uppercase !text-[#8a6a3e]">
            Immutable ledger
          </Text>
          <Title level={2} className="!mt-1 !mb-1 !text-[26px]">
            资金流水
          </Title>
          <Text type="secondary">追加记录、追溯冲正；账户余额始终由有效流水重算。</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          新增流水
        </Button>
      </div>

      <div className="workspace-panel overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-[#edf0f2]">
          <Text strong>全部记录</Text>
          <Text type="secondary" className="text-xs">
            {ledger.data?.length ?? 0} 条 · CNY
          </Text>
        </div>
        <Table
          rowKey="id"
          loading={ledger.isLoading}
          dataSource={ledger.data ?? []}
          pagination={{ pageSize: 12 }}
          locale={{ emptyText: "暂无流水；先录入一笔资金转入" }}
          columns={[
            { title: "业务日期", dataIndex: "businessDate", width: 120 },
            {
              title: "类型",
              dataIndex: "type",
              width: 125,
              render: (value: EntryType) => (
                <Tag bordered={false}>{LABELS[value]}</Tag>
              ),
            },
            { title: "股票 / 品种", render: (_, row) => row.symbol ?? row.repoCode ?? "—" },
            {
              title: "金额",
              render: (_, row) =>
                money(
                  row.amount ??
                    (row.price && row.quantity ? row.price * row.quantity : undefined),
                ),
            },
            { title: "数量", render: (_, row) => row.quantity ?? "—" },
            { title: "备注", dataIndex: "note", ellipsis: true },
            {
              title: "",
              width: 86,
              render: (_, row) =>
                row.type === "adjustment" ? (
                  <Text type="secondary" className="text-xs">
                    已冲正
                  </Text>
                ) : (
                  <Popconfirm
                    title="创建冲正记录？"
                    description="原记录不会被修改；如需修正，请在冲正后新增正确流水。"
                    onConfirm={() => reverseMutation.mutate({ id: row.id })}
                  >
                    <Button type="text" size="small" icon={<RollbackOutlined />}>
                      冲正
                    </Button>
                  </Popconfirm>
                ),
            },
          ]}
        />
      </div>

      <Modal
        title="新增流水"
        open={open}
        onCancel={() => setOpen(false)}
        okText="追加记录"
        confirmLoading={addMutation.isPending}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            type: "transfer_in",
            businessDate: new Date().toISOString().slice(0, 10),
            fee: 0,
          }}
          onFinish={(values) => addMutation.mutate(values)}
        >
          <div className="grid grid-cols-2 gap-x-3">
            <Form.Item name="type" label="流水类型" rules={[{ required: true }]}>
              <Select options={ENTRY_OPTIONS} />
            </Form.Item>
            <Form.Item name="businessDate" label="业务日期" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
          </div>
          {["transfer_in", "transfer_out", "dividend", "reverse_repo"].includes(
            entryType,
          ) && (
            <Form.Item name="amount" label={entryType === "reverse_repo" ? "本金" : "金额"}>
              <InputNumber min={0.01} suffix="元" className="w-full" />
            </Form.Item>
          )}
          {["buy", "sell", "dividend"].includes(entryType) && (
            <Form.Item name="symbol" label="A 股代码">
              <Input maxLength={6} placeholder="例如 601398" />
            </Form.Item>
          )}
          {["buy", "sell"].includes(entryType) && (
            <div className="grid grid-cols-3 gap-x-3">
              <Form.Item name="price" label="成交价">
                <InputNumber min={0.01} precision={3} className="w-full" />
              </Form.Item>
              <Form.Item name="quantity" label="数量">
                <InputNumber min={100} step={100} className="w-full" />
              </Form.Item>
              <Form.Item name="fee" label="费用">
                <InputNumber min={0} precision={2} className="w-full" />
              </Form.Item>
            </div>
          )}
          {entryType === "dividend" && (
            <div className="grid grid-cols-2 gap-x-3">
              <Form.Item name="recordDate" label="登记日">
                <Input type="date" />
              </Form.Item>
              <Form.Item name="paymentDate" label="到账日">
                <Input type="date" />
              </Form.Item>
            </div>
          )}
          {entryType === "reverse_repo" && (
            <>
              <div className="grid grid-cols-3 gap-x-3">
                <Form.Item name="repoCode" label="品种">
                  <Input placeholder="204001" />
                </Form.Item>
                <Form.Item name="annualRate" label="年化收益率">
                  <InputNumber min={0} suffix="%" className="w-full" />
                </Form.Item>
                <Form.Item name="termDays" label="期限">
                  <InputNumber min={1} suffix="天" className="w-full" />
                </Form.Item>
              </div>
              <div className="grid grid-cols-2 gap-x-3">
                <Form.Item name="maturityDate" label="到期日">
                  <Input type="date" />
                </Form.Item>
                <Form.Item name="maturityAmount" label="到期金额">
                  <InputNumber min={0} suffix="元" className="w-full" />
                </Form.Item>
              </div>
            </>
          )}
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
