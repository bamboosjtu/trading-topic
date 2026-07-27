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
  EntryType,
  LedgerEntryInput,
  LedgerImpactPreview,
  LedgerRecordView,
  SecurityType,
  StockInfo,
} from "../../api/client";
import { api } from "../../api/client";
import { DIRECT_ENTRY_TYPE_OPTIONS } from "./liveConstants";
import { money, numberValue } from "./liveFormat";

interface LedgerFormValues {
  type: Exclude<EntryType, "adjustment">;
  businessDate: Dayjs;
  securityType?: SecurityType;
  symbol?: string;
  instrumentName?: string;
  amount?: number;
  price?: number;
  lots?: number;
  fee?: number;
  perShare?: number;
  recordDate?: Dayjs;
  paymentDate?: Dayjs;
  repoCode?: string;
  annualRatePercent?: number;
  termDays?: number;
  maturityAmount?: number;
  maturityDate?: Dayjs;
  note?: string;
}

function rowToForm(row: LedgerRecordView): Partial<LedgerFormValues> {
  return {
    type: row.type === "adjustment" ? "transfer_in" : row.type,
    businessDate: dayjs(row.businessDate),
    securityType: row.securityType ?? undefined,
    symbol: row.symbol ?? undefined,
    instrumentName: row.name ?? undefined,
    amount: row.amount ?? undefined,
    price: row.price ?? undefined,
    lots: row.quantity === null ? undefined : row.quantity / 100,
    fee: row.fee,
    perShare: row.perShare ?? undefined,
    recordDate: row.recordDate ? dayjs(row.recordDate) : undefined,
    paymentDate: row.paymentDate ? dayjs(row.paymentDate) : undefined,
    repoCode: row.repoCode ?? undefined,
    annualRatePercent:
      row.annualRate === null ? undefined : row.annualRate * 100,
    termDays: row.termDays ?? undefined,
    maturityAmount: row.maturityAmount ?? undefined,
    maturityDate: row.maturityDate ? dayjs(row.maturityDate) : undefined,
    note: row.note ?? undefined,
  };
}

function toLedgerInput(values: LedgerFormValues): LedgerEntryInput {
  return {
    type: values.type,
    businessDate: values.businessDate.format("YYYY-MM-DD"),
    securityType: values.securityType,
    symbol: values.symbol?.trim(),
    instrumentName: values.instrumentName?.trim(),
    amount: values.amount,
    price: values.price,
    quantity:
      values.lots === undefined ? undefined : Math.round(values.lots * 100),
    fee: values.fee,
    perShare: values.perShare,
    recordDate: values.recordDate?.format("YYYY-MM-DD"),
    paymentDate: values.paymentDate?.format("YYYY-MM-DD"),
    repoCode: values.repoCode?.trim(),
    annualRate:
      values.annualRatePercent === undefined
        ? undefined
        : values.annualRatePercent / 100,
    termDays: values.termDays,
    maturityAmount: values.maturityAmount,
    maturityDate: values.maturityDate?.format("YYYY-MM-DD"),
    note: values.note?.trim(),
  };
}

function ImpactValue({
  label,
  before,
  after,
  quantity = false,
}: {
  label: string;
  before: number;
  after: number;
  quantity?: boolean;
}) {
  const render = quantity ? numberValue : money;
  return (
    <div>
      <span>{label}</span>
      <strong className="tabular-nums">
        {render(before)} <i>→</i> {render(after)}
      </strong>
    </div>
  );
}

export function LedgerEntryModal({
  open,
  correctionTarget,
  stocks,
  onClose,
  onSaved,
}: {
  open: boolean;
  correctionTarget: LedgerRecordView | null;
  stocks: readonly StockInfo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<LedgerFormValues>();
  const entryType = Form.useWatch("type", form);
  const [preview, setPreview] = useState<LedgerImpactPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const isSecurityEntry = ["buy", "sell", "dividend"].includes(entryType);
  const isTrade = entryType === "buy" || entryType === "sell";
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
    setPreview(null);
    form.resetFields();
    form.setFieldsValue(
      correctionTarget
        ? rowToForm(correctionTarget)
        : {
            type: "buy",
            businessDate: dayjs(),
            securityType: "stock",
            fee: 0,
          },
    );
  }, [correctionTarget, form, open]);

  const readInput = async (): Promise<LedgerEntryInput> => {
    const values = await form.validateFields();
    return toLedgerInput(values);
  };

  const runPreview = async (): Promise<LedgerImpactPreview | null> => {
    try {
      setPreviewing(true);
      const input = await readInput();
      const result = await api.previewLedger(input, correctionTarget?.id);
      setPreview(result);
      if (result.normalizedInput.maturityDate) {
        form.setFieldValue(
          "maturityDate",
          dayjs(result.normalizedInput.maturityDate),
        );
      }
      if (result.normalizedInput.maturityAmount !== undefined) {
        form.setFieldValue(
          "maturityAmount",
          result.normalizedInput.maturityAmount,
        );
      }
      return result;
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
      setPreview(null);
      return null;
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async () => {
    try {
      setSaving(true);
      const result = await runPreview();
      if (!result) return;
      if (correctionTarget) {
        await api.correctLedger(correctionTarget.id, result.normalizedInput);
        message.success("修正记录已追加，原流水完整保留");
      } else {
        await api.addLedger(result.normalizedInput);
        message.success("交易流水已保存");
      }
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
      className="ledger-entry-modal"
      width={760}
      centered
      destroyOnClose
      maskClosable={false}
      open={open}
      title={correctionTarget ? "追加修正" : "录入交易"}
      onCancel={saving ? undefined : onClose}
      footer={[
        <Button key="cancel" disabled={saving} onClick={onClose}>
          取消
        </Button>,
        <Button
          key="preview"
          loading={previewing && !saving}
          disabled={saving}
          onClick={() => void runPreview()}
        >
          校验并预览
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={saving}
          disabled={!preview}
          onClick={() => void submit()}
        >
          {correctionTarget ? "确认追加修正" : "确认录入"}
        </Button>,
      ]}
    >
      {correctionTarget ? (
        <Alert
          showIcon
          type="info"
          message="本次修正将追加一条新事实记录，并撤销原记录影响；原流水不会被覆盖或删除。"
        />
      ) : null}
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        onValuesChange={() => setPreview(null)}
      >
        <div className="ledger-form-grid">
          <Form.Item
            label="流水类型"
            name="type"
            rules={[{ required: true, message: "请选择流水类型" }]}
          >
            <Select options={DIRECT_ENTRY_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item
            label="业务日期"
            name="businessDate"
            rules={[{ required: true, message: "请选择业务日期" }]}
          >
            <DatePicker />
          </Form.Item>
          {isSecurityEntry ? (
            <>
              <Form.Item
                label="资产类型"
                name="securityType"
                rules={[{ required: true, message: "请选择资产类型" }]}
              >
                <Select
                  options={[
                    { label: "A 股股票", value: "stock" },
                    { label: "ETF", value: "etf" },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label="证券代码"
                name="symbol"
                rules={[
                  { required: true, message: "请输入证券代码" },
                  { pattern: /^\d{6}$/, message: "请输入 6 位证券代码" },
                ]}
                extra="A 股可从完整代码表搜索；ETF 或未缓存标的可直接输入代码。"
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
                  onChange={(value) => {
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
                <Input placeholder="自动补全后仍可修正" maxLength={40} />
              </Form.Item>
            </>
          ) : null}
          {isTrade ? (
            <>
              <Form.Item
                label="数量（手）"
                name="lots"
                rules={[{ required: true, message: "请输入成交手数" }]}
              >
                <InputNumber min={1} precision={0} />
              </Form.Item>
              <Form.Item
                label="成交价格"
                name="price"
                rules={[{ required: true, message: "请输入成交价格" }]}
              >
                <InputNumber min={0} precision={4} prefix="¥" />
              </Form.Item>
              <Form.Item label="实际费用" name="fee">
                <InputNumber min={0} precision={2} prefix="¥" />
              </Form.Item>
            </>
          ) : null}
          {["transfer_in", "transfer_out", "dividend"].includes(entryType) ? (
            <Form.Item
              label={entryType === "dividend" ? "分红到账金额" : "资金金额"}
              name="amount"
              rules={[{ required: true, message: "请输入金额" }]}
            >
              <InputNumber min={0} precision={2} prefix="¥" />
            </Form.Item>
          ) : null}
          {entryType === "dividend" ? (
            <>
              <Form.Item label="每股分红（可选）" name="perShare">
                <InputNumber min={0} precision={6} prefix="¥" />
              </Form.Item>
              <Form.Item label="股权登记日（可选）" name="recordDate">
                <DatePicker />
              </Form.Item>
              <Form.Item label="分红到账日（可选）" name="paymentDate">
                <DatePicker />
              </Form.Item>
            </>
          ) : null}
          {entryType === "reverse_repo" ? (
            <>
              <Form.Item
                label="代码 / 品种"
                name="repoCode"
                rules={[{ required: true, message: "请输入逆回购代码或品种" }]}
              >
                <Input placeholder="例如 204001 / GC001" maxLength={32} />
              </Form.Item>
              <Form.Item
                label="本金"
                name="amount"
                rules={[{ required: true, message: "请输入本金" }]}
              >
                <InputNumber min={0} precision={2} prefix="¥" />
              </Form.Item>
              <Form.Item
                label="成交年化收益率"
                name="annualRatePercent"
                rules={[{ required: true, message: "请输入成交年化收益率" }]}
              >
                <InputNumber min={0} precision={4} suffix="%" />
              </Form.Item>
              <Form.Item
                label="期限（天）"
                name="termDays"
                rules={[{ required: true, message: "请输入期限" }]}
              >
                <InputNumber min={1} precision={0} />
              </Form.Item>
              <Form.Item label="费用" name="fee">
                <InputNumber min={0} precision={2} prefix="¥" />
              </Form.Item>
              <Form.Item label="到期日（可自动计算）" name="maturityDate">
                <DatePicker />
              </Form.Item>
              <Form.Item label="到期金额（可自动计算）" name="maturityAmount">
                <InputNumber min={0} precision={2} prefix="¥" />
              </Form.Item>
            </>
          ) : null}
          <Form.Item className="ledger-note-field" label="备注" name="note">
            <Input.TextArea
              maxLength={500}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="可选，记录事实来源或说明"
            />
          </Form.Item>
        </div>
      </Form>
      <section className="ledger-impact-panel">
        <div className="ledger-impact-heading">
          <strong>本次影响摘要</strong>
          <span>
            {preview
              ? `发生金额 ${money(preview.tradeAmount)}`
              : "填写完成后先校验预览，领域层将返回账本影响。"}
          </span>
        </div>
        {preview ? (
          <>
            <div className="ledger-impact-grid">
              <ImpactValue
                label="可用现金"
                before={preview.before.availableCash}
                after={preview.after.availableCash}
              />
              <ImpactValue
                label="标的数量"
                before={preview.before.holdingQuantity}
                after={preview.after.holdingQuantity}
                quantity
              />
              <ImpactValue
                label="持仓成本"
                before={preview.before.holdingCost}
                after={preview.after.holdingCost}
              />
              <ImpactValue
                label="累计分红"
                before={preview.before.cumulativeDividend}
                after={preview.after.cumulativeDividend}
              />
              <ImpactValue
                label="待到账资产"
                before={preview.before.pendingReverseRepoAsset}
                after={preview.after.pendingReverseRepoAsset}
              />
            </div>
            {preview.warnings.map((warning) => (
              <Alert key={warning} showIcon type="warning" message={warning} />
            ))}
          </>
        ) : (
          <div className="ledger-impact-placeholder">
            成交金额、现金、持仓数量、成本、累计分红与待到账资产均不在 Renderer 计算。
          </div>
        )}
      </section>
    </Modal>
  );
}
