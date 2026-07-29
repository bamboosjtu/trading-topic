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
import { currentMarketDate } from "../../../../shared/marketDate";
import { securityTypeForInstrument } from "../../../../shared/instruments";
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
  quantity?: number;
  fee?: number;
  perShare?: number;
  recordDate?: Dayjs;
  note?: string;
}

interface InstrumentCatalogStatus {
  loading: boolean;
  error?: string;
}

interface InstrumentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function rowToForm(row: LedgerRecordView): Partial<LedgerFormValues> {
  return {
    type: row.type === "adjustment" ? "buy" : row.type,
    businessDate: dayjs(row.businessDate),
    securityType: row.securityType ?? undefined,
    symbol: row.symbol ?? undefined,
    instrumentName: row.name ?? undefined,
    amount: row.amount ?? undefined,
    price: row.price ?? undefined,
    quantity: row.quantity ?? undefined,
    fee: row.fee,
    perShare: row.perShare ?? undefined,
    recordDate: row.recordDate ? dayjs(row.recordDate) : undefined,
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
    quantity: values.quantity,
    fee: values.fee,
    perShare: values.perShare,
    recordDate: values.recordDate?.format("YYYY-MM-DD"),
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
  catalogStatus,
  onRetryCatalog,
  onClose,
  onSaved,
}: {
  open: boolean;
  correctionTarget: LedgerRecordView | null;
  stocks: readonly StockInfo[];
  catalogStatus: Record<SecurityType, InstrumentCatalogStatus>;
  onRetryCatalog: (type: SecurityType) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<LedgerFormValues>();
  const entryType = Form.useWatch("type", form);
  const securityType = Form.useWatch("securityType", form);
  const [preview, setPreview] = useState<LedgerImpactPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const isSecurityEntry = ["buy", "sell", "dividend"].includes(entryType);
  const isTrade = entryType === "buy" || entryType === "sell";
  const stockBySymbol = useMemo(
    () => new Map(stocks.map((stock) => [stock.symbol, stock])),
    [stocks],
  );
  const symbolOptions = useMemo<InstrumentOption[]>(
    () =>
      stocks
        .filter(
          (stock) =>
            !securityType ||
            securityTypeForInstrument(stock) === securityType,
        )
        .map((stock) => ({
          value: stock.symbol,
          label: `${stock.name} ${stock.symbol}`,
        })),
    [securityType, stocks],
  );
  const activeSecurityType = securityType ?? "stock";
  const activeCatalogStatus = catalogStatus[activeSecurityType];
  const displayedSymbolOptions: InstrumentOption[] = symbolOptions.length
    ? symbolOptions
    : [
        {
          value: "__catalog_status__",
          label: activeCatalogStatus.loading
            ? "正在加载证券目录…"
            : activeCatalogStatus.error
              ? "证券目录加载失败，点击重试"
              : "当前资产类型暂无可用标的",
          disabled: true,
        },
      ];

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    form.resetFields();
    form.setFieldsValue(
      correctionTarget
        ? rowToForm(correctionTarget)
        : {
            type: "buy",
            businessDate: dayjs(currentMarketDate()),
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
          message="本次修正采用历史重述：分析视图会在原业务日期使用新事实；原流水与修正记录仍完整保留。"
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
            label={entryType === "dividend" ? "分红到账日" : "业务日期"}
            name="businessDate"
            rules={[{ required: true, message: "请选择业务日期" }]}
          >
            <DatePicker
              disabledDate={(value) =>
                value.format("YYYY-MM-DD") > currentMarketDate() ||
                (isTrade && (value.day() === 0 || value.day() === 6))
              }
            />
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
                  onChange={() => {
                    form.setFieldValue("symbol", undefined);
                    form.setFieldValue("instrumentName", undefined);
                  }}
                />
              </Form.Item>
              <Form.Item
                label="证券代码"
                name="symbol"
                rules={[
                  { required: true, message: "请输入证券代码" },
                  { pattern: /^\d{6}$/, message: "请输入 6 位证券代码" },
                ]}
                extra="A 股股票与境内交易所 ETF 均可从完整目录搜索；未缓存标的仍可直接输入代码。"
              >
                <AutoComplete
                  options={displayedSymbolOptions}
                  filterOption={(input, option) =>
                    Boolean(option?.disabled) ||
                    String(option?.label ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  onSelect={(value) => {
                    const stock = stockBySymbol.get(value);
                    if (stock) {
                      form.setFieldValue("instrumentName", stock.name);
                      form.setFieldValue(
                        "securityType",
                        securityTypeForInstrument(stock),
                      );
                    }
                  }}
                  onChange={(value) => {
                    const stock = stockBySymbol.get(value);
                    if (stock) {
                      form.setFieldValue("instrumentName", stock.name);
                      form.setFieldValue(
                        "securityType",
                        securityTypeForInstrument(stock),
                      );
                    }
                  }}
                  onDropdownVisibleChange={(visible) => {
                    if (
                      visible &&
                      activeCatalogStatus.error &&
                      !activeCatalogStatus.loading
                    ) {
                      onRetryCatalog(activeSecurityType);
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
                label="数量 / 份额"
                name="quantity"
                rules={[{ required: true, message: "请输入实际成交数量" }]}
                extra={
                  entryType === "buy"
                    ? "股票买入通常为 100 股整数倍；零股、ETF 份额和修正事实按实际数量录入。"
                    : "卖出允许录入不超过可用持仓的实际整数数量。"
                }
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
          {entryType === "dividend" ? (
            <Form.Item
              label="分红到账金额"
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
                label="累计买入支出"
                before={preview.before.cumulativeBuySpend}
                after={preview.after.cumulativeBuySpend}
              />
              <ImpactValue
                label="累计卖出净收入"
                before={preview.before.cumulativeSellNetIncome}
                after={preview.after.cumulativeSellNetIncome}
              />
              <ImpactValue
                label="累计净投入"
                before={preview.before.netInvestment}
                after={preview.after.netInvestment}
              />
            </div>
            {preview.warnings.map((warning) => (
              <Alert key={warning} showIcon type="warning" message={warning} />
            ))}
          </>
        ) : (
          <div className="ledger-impact-placeholder">
            成交金额、持仓数量、成本、累计分红与净投入均由领域层计算。
          </div>
        )}
      </section>
    </Modal>
  );
}
