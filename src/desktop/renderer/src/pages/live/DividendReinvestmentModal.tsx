import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type {
  DividendReinvestmentInput,
  SecurityType,
  StockInfo,
} from "../../api/client";
import { api } from "../../api/client";
import { currentMarketDate } from "../../../../shared/marketDate";

interface Values {
  symbol: string;
  instrumentName: string;
  securityType: SecurityType;
  dividendDate: Dayjs;
  dividendAmount: number;
  perShare?: number;
  recordDate?: Dayjs;
  reinvestmentDate: Dayjs;
  buyPrice: number;
  buyQuantity: number;
  fee?: number;
  note?: string;
}

export function DividendReinvestmentModal({
  open,
  stocks,
  onClose,
  onSaved,
}: {
  open: boolean;
  stocks: readonly StockInfo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const stockBySymbol = useMemo(
    () => new Map(stocks.map((stock) => [stock.symbol, stock])),
    [stocks],
  );
  const symbolOptions = useMemo(
    () =>
      stocks.map((stock) => ({
        value: stock.symbol,
        label: `${stock.name} ${stock.symbol}`,
      })),
    [stocks],
  );

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const today = dayjs(currentMarketDate());
    form.setFieldsValue({
      securityType: "stock",
      dividendDate: today,
      reinvestmentDate: today,
      fee: 0,
    });
  }, [form, open]);

  const submit = async () => {
    try {
      setSaving(true);
      const values = await form.validateFields();
      const input: DividendReinvestmentInput = {
        symbol: values.symbol.trim(),
        instrumentName: values.instrumentName.trim(),
        securityType: values.securityType,
        dividendDate: values.dividendDate.format("YYYY-MM-DD"),
        dividendAmount: values.dividendAmount,
        perShare: values.perShare,
        recordDate: values.recordDate?.format("YYYY-MM-DD"),
        reinvestmentDate: values.reinvestmentDate.format("YYYY-MM-DD"),
        buyPrice: values.buyPrice,
        buyQuantity: values.buyQuantity,
        fee: values.fee,
        note: values.note?.trim(),
      };
      await api.addDividendReinvestment(input);
      message.success("分红与再投入买入已在同一事务中保存");
      onSaved();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      width={820}
      centered
      destroyOnClose
      maskClosable={false}
      open={open}
      title="分红并再投入"
      onCancel={saving ? undefined : onClose}
      footer={[
        <Button key="cancel" disabled={saving} onClick={onClose}>
          取消
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={() => void submit()}>
          保存两条关联事实
        </Button>,
      ]}
    >
      <Alert
        showIcon
        type="info"
        message="系统会原子写入一条分红事实和一条买入事实。买入支出超过分红的部分自然计入累计净投入。"
      />
      <Form form={form} layout="vertical" requiredMark="optional">
        <div className="ledger-form-grid">
          <Form.Item
            label="证券代码"
            name="symbol"
            rules={[
              { required: true, message: "请输入证券代码" },
              { pattern: /^\d{6}$/, message: "请输入 6 位证券代码" },
            ]}
          >
            <AutoComplete
              options={symbolOptions}
              filterOption={(input, option) =>
                String(option?.label ?? "")
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              onSelect={(value) => {
                const stock = stockBySymbol.get(value);
                if (stock) {
                  form.setFieldValue("instrumentName", stock.name);
                  form.setFieldValue("securityType", "stock");
                }
              }}
            />
          </Form.Item>
          <Form.Item
            label="标的名称"
            name="instrumentName"
            rules={[{ required: true, message: "请确认标的名称" }]}
          >
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item
            label="资产类型"
            name="securityType"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { label: "A 股股票", value: "stock" },
                { label: "ETF", value: "etf" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="分红到账日"
            name="dividendDate"
            rules={[{ required: true }]}
          >
            <DatePicker />
          </Form.Item>
          <Form.Item
            label="分红到账金额"
            name="dividendAmount"
            rules={[{ required: true }]}
          >
            <InputNumber min={0.01} precision={2} prefix="¥" />
          </Form.Item>
          <Form.Item label="每股分红（可选）" name="perShare">
            <InputNumber min={0} precision={6} prefix="¥" />
          </Form.Item>
          <Form.Item label="股权登记日（可选）" name="recordDate">
            <DatePicker />
          </Form.Item>
          <Form.Item
            label="再投入日期"
            name="reinvestmentDate"
            rules={[{ required: true }]}
          >
            <DatePicker />
          </Form.Item>
          <Form.Item
            label="买入价格"
            name="buyPrice"
            rules={[{ required: true }]}
          >
            <InputNumber min={0.0001} precision={4} prefix="¥" />
          </Form.Item>
          <Form.Item
            label="实际买入数量 / 份额"
            name="buyQuantity"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} precision={0} />
          </Form.Item>
          <Form.Item label="买入费用" name="fee">
            <InputNumber min={0} precision={2} prefix="¥" />
          </Form.Item>
          <Form.Item className="ledger-note-field" label="备注" name="note">
            <Input.TextArea maxLength={500} autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
