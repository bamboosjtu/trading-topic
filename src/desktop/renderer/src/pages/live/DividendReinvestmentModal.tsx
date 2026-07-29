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
  DividendReinvestmentPreview,
  SecurityType,
  StockInfo,
} from "../../api/client";
import { api } from "../../api/client";
import { currentMarketDate } from "../../../../shared/marketDate";
import { securityTypeForInstrument } from "../../../../shared/instruments";
import { money, numberValue } from "./liveFormat";

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

interface InstrumentCatalogStatus {
  loading: boolean;
  error?: string;
}

interface InstrumentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function DividendReinvestmentModal({
  open,
  stocks,
  catalogStatus,
  onRetryCatalog,
  onClose,
  onSaved,
}: {
  open: boolean;
  stocks: readonly StockInfo[];
  catalogStatus: Record<SecurityType, InstrumentCatalogStatus>;
  onRetryCatalog: (type: SecurityType) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const dividendDate = Form.useWatch("dividendDate", form);
  const securityType = Form.useWatch("securityType", form);
  const [preview, setPreview] =
    useState<DividendReinvestmentPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
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
    const today = dayjs(currentMarketDate());
    form.setFieldsValue({
      securityType: "stock",
      dividendDate: today,
      reinvestmentDate: today,
      fee: 0,
    });
  }, [form, open]);

  const readInput = async (): Promise<DividendReinvestmentInput> => {
    const values = await form.validateFields();
    return {
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
  };

  const runPreview = async (): Promise<DividendReinvestmentPreview | null> => {
    try {
      setPreviewing(true);
      const result = await api.previewDividendReinvestment(await readInput());
      setPreview(result);
      return result;
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      setPreview(null);
      return null;
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async () => {
    try {
      setSaving(true);
      const checked = await runPreview();
      if (!checked) return;
      const input = await readInput();
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
          保存两条关联事实
        </Button>,
      ]}
    >
      <Alert
        showIcon
        type="info"
        message="系统会原子写入一条分红事实和一条买入事实。买入支出超过分红的部分自然计入累计净投入。"
      />
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        onValuesChange={() => setPreview(null)}
      >
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
              onChange={() => {
                form.setFieldValue("symbol", undefined);
                form.setFieldValue("instrumentName", undefined);
              }}
            />
          </Form.Item>
          <Form.Item
            label="分红到账日"
            name="dividendDate"
            rules={[{ required: true }]}
          >
            <DatePicker
              disabledDate={(value) =>
                value.format("YYYY-MM-DD") > currentMarketDate()
              }
            />
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
            dependencies={["dividendDate"]}
            rules={[
              { required: true },
              {
                validator: async (_, value?: Dayjs) => {
                  if (
                    value &&
                    dividendDate &&
                    value.isBefore(dividendDate, "day")
                  ) {
                    throw new Error("再投入日期不得早于分红到账日期");
                  }
                },
              },
            ]}
          >
            <DatePicker
              disabledDate={(value) =>
                value.format("YYYY-MM-DD") > currentMarketDate() ||
                value.day() === 0 ||
                value.day() === 6 ||
                Boolean(dividendDate && value.isBefore(dividendDate, "day"))
              }
            />
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
      <section className="ledger-impact-panel">
        <div className="ledger-impact-heading">
          <strong>原子操作影响预览</strong>
          <span>
            {preview
              ? "分红与再投入买入均校验通过"
              : "保存前必须校验两条关联事实的合并影响。"}
          </span>
        </div>
        {preview ? (
          <>
            <div className="ledger-impact-grid">
              <div>
                <span>标的数量</span>
                <strong className="tabular-nums">
                  {numberValue(preview.before.holdingQuantity)} <i>→</i>{" "}
                  {numberValue(preview.after.holdingQuantity)}
                </strong>
              </div>
              <div>
                <span>累计分红</span>
                <strong className="tabular-nums">
                  {money(preview.before.cumulativeDividend)} <i>→</i>{" "}
                  {money(preview.after.cumulativeDividend)}
                </strong>
              </div>
              <div>
                <span>累计买入支出</span>
                <strong className="tabular-nums">
                  {money(preview.before.cumulativeBuySpend)} <i>→</i>{" "}
                  {money(preview.after.cumulativeBuySpend)}
                </strong>
              </div>
              <div>
                <span>累计净投入</span>
                <strong className="tabular-nums">
                  {money(preview.before.netInvestment)} <i>→</i>{" "}
                  {money(preview.after.netInvestment)}
                </strong>
              </div>
            </div>
            {preview.warnings.map((warning) => (
              <Alert key={warning} showIcon type="warning" message={warning} />
            ))}
          </>
        ) : (
          <div className="ledger-impact-placeholder">
            领域层会先预演分红到账，再以该状态预演买入；任一校验失败都不会写入。
          </div>
        )}
      </section>
    </Modal>
  );
}
