import {
  Button,
  Form,
  Input,
  InputNumber,
  Popover,
  Select,
  Skeleton,
} from "antd";
import { PlusOutlined, SettingOutlined } from "@ant-design/icons";
import type { FormInstance } from "antd";
import {
  BACKTEST_CALIBER_VERSION,
  BACKTEST_MAX_SYMBOLS,
  BACKTEST_RANGE_YEARS,
  DEFAULT_BACKTEST_SYMBOLS,
} from "../../../../shared/constants";
import type { BacktestRequest } from "../../api/client";
import {
  dateYearsAgo,
  today,
  type BacktestRangePreset,
} from "./dateUtils";

interface StockOption {
  value: string;
  label: string;
  searchText: string;
}

interface BacktestConfigProps {
  form: FormInstance<BacktestRequest>;
  disabled: boolean;
  rangePreset: BacktestRangePreset;
  rulesExpanded: boolean;
  stockOptions: StockOption[];
  stocksLoading: boolean;
  stocksError: boolean;
  symbolPickerOpen: boolean;
  submitting: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onBeginDraft: () => void;
  onRangePresetChange: (preset: BacktestRangePreset) => void;
  onRetryStocks: () => void;
  onSubmit: (request: BacktestRequest) => void;
}

export function BacktestConfig({
  form,
  disabled,
  rangePreset,
  rulesExpanded,
  stockOptions,
  stocksLoading,
  stocksError,
  symbolPickerOpen,
  submitting,
  onPickerOpenChange,
  onBeginDraft,
  onRangePresetChange,
  onRetryStocks,
  onSubmit,
}: BacktestConfigProps) {
  const buyDay = Form.useWatch("buyDay", form) ?? 1;
  const startDate = Form.useWatch("startDate", form) ?? dateYearsAgo(3);
  const endDate = Form.useWatch("endDate", form) ?? today();
  const selectedSymbols = Form.useWatch("symbols", form) ?? [];

  const setDatePreset = (years: 3 | 5 | 10 | 15) => {
    onBeginDraft();
    onRangePresetChange(years);
    form.setFieldsValue({
      startDate: dateYearsAgo(years),
      endDate: today(),
      rangeYears: years,
    });
  };

  return (
    <section className="workspace-panel backtest-config">
      <Form
        form={form}
        disabled={disabled}
        layout="vertical"
        initialValues={{
          symbols: [...DEFAULT_BACKTEST_SYMBOLS],
          startDate: dateYearsAgo(3),
          endDate: today(),
          monthlyAmount: 3000,
          buyDay: 1,
          rangeYears: 3,
          caliberVersion: BACKTEST_CALIBER_VERSION,
        }}
        onFinish={(values) =>
          onSubmit({
            ...values,
            rangeYears:
              rangePreset === "custom" ? undefined : rangePreset,
          })
        }
        onValuesChange={onBeginDraft}
      >
        <Form.Item name="buyDay" hidden>
          <InputNumber />
        </Form.Item>
        <Form.Item name="caliberVersion" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="startDate" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="endDate" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="rangeYears" hidden>
          <InputNumber />
        </Form.Item>

        <div className="backtest-config-grid">
          <div className="symbol-field">
            <div className="field-label required-label">标的选择</div>
            <div className="symbol-control-row">
              <Form.Item
                name="symbols"
                rules={[{ required: true, message: "至少选择一个标的" }]}
                className="!mb-0 min-w-0 flex-1"
              >
                <Select
                  mode="multiple"
                  maxCount={BACKTEST_MAX_SYMBOLS}
                  maxTagCount="responsive"
                  options={stockOptions}
                  placeholder={
                    stocksLoading ? "正在加载 A 股列表…" : "输入名称或代码搜索"
                  }
                  className="backtest-symbol-select"
                  open={symbolPickerOpen}
                  onOpenChange={onPickerOpenChange}
                  showSearch
                  filterOption={(input, option) =>
                    String(option?.searchText ?? "").includes(
                      input.trim().toLocaleLowerCase("zh-CN"),
                    )
                  }
                  optionRender={(option) => (
                    <div className="stock-option">
                      <span>{option.data.label}</span>
                      <small className="tabular-nums">{option.value}</small>
                    </div>
                  )}
                  notFoundContent={
                    stocksLoading ? (
                      <Skeleton active paragraph={{ rows: 2 }} title={false} />
                    ) : stocksError ? (
                      <div className="stock-universe-error">
                        <span>全 A 股目录加载失败</span>
                        <Button type="link" size="small" onClick={onRetryStocks}>
                          重试
                        </Button>
                      </div>
                    ) : (
                      "未找到匹配的 A 股"
                    )
                  }
                />
              </Form.Item>
              <Button
                type="default"
                size="small"
                icon={<PlusOutlined />}
                className="add-symbol-button"
                disabled={
                  disabled || selectedSymbols.length >= BACKTEST_MAX_SYMBOLS
                }
                onClick={() => onPickerOpenChange(true)}
              >
                添加标的
              </Button>
            </div>
          </div>

          <div className="backtest-range">
            <div className="field-label">回测区间</div>
            <div className="range-control-row">
              <div className="range-shortcuts" aria-label="快捷回测区间">
                {BACKTEST_RANGE_YEARS.map((range) => (
                  <button
                    key={range}
                    type="button"
                    disabled={disabled}
                    className={rangePreset === range ? "active" : ""}
                    onClick={() => setDatePreset(range)}
                  >
                    {range}年
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Form.Item name="monthlyAmount" label="每月投入金额" className="!mb-0">
            <InputNumber<number>
              min={100}
              step={500}
              precision={2}
              suffix="元"
              className="w-full"
              formatter={(value) =>
                value === undefined
                  ? ""
                  : Number(value).toLocaleString("zh-CN", {
                      minimumFractionDigits: 2,
                    })
              }
              parser={(value) => Number(value?.replaceAll(",", "") ?? 0)}
            />
          </Form.Item>

          <div>
            <div className="field-label fee-label">
              <span>费用模式</span>
              <Popover
                placement="bottomRight"
                trigger="click"
                content={
                  <div className="advanced-settings">
                    <label htmlFor="advanced-start-date">开始日期</label>
                    <Input
                      id="advanced-start-date"
                      type="date"
                      value={startDate}
                      onChange={(event) => {
                        onBeginDraft();
                        form.setFieldValue("startDate", event.target.value);
                        form.setFieldValue("rangeYears", undefined);
                        onRangePresetChange("custom");
                      }}
                    />
                    <label htmlFor="advanced-end-date">结束日期</label>
                    <Input
                      id="advanced-end-date"
                      type="date"
                      value={endDate}
                      onChange={(event) => {
                        onBeginDraft();
                        form.setFieldValue("endDate", event.target.value);
                        form.setFieldValue("rangeYears", undefined);
                        onRangePresetChange("custom");
                      }}
                    />
                    <label htmlFor="advanced-buy-day">指定买入日</label>
                    <InputNumber
                      id="advanced-buy-day"
                      min={1}
                      max={28}
                      value={buyDay}
                      suffix="日"
                      onChange={(value) => {
                        onBeginDraft();
                        form.setFieldValue("buyDay", value ?? 1);
                      }}
                    />
                    <p>非交易日自动顺延到下一交易日。</p>
                  </div>
                }
              >
                <button
                  type="button"
                  className="inline-link compact"
                  disabled={disabled}
                >
                  <SettingOutlined />
                  高级设置
                </button>
              </Popover>
            </div>
            <div
              className="fee-mode-display"
              aria-label="费用模式：R1 简化费用 0 元"
            >
              R1 简化费用（0 元）
            </div>
          </div>

          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            className="start-backtest-button"
          >
            开始回测
          </Button>
        </div>

        {rulesExpanded && (
          <div className="backtest-rules-expanded">
            不复权收盘价；允许零碎股；指定买入日遇非交易日顺延；送股与转增按除权日增加股数；
            现金分红到账后立即全额回购原标的；费用 0 元，不计印花税和过户费。
          </div>
        )}
      </Form>
    </section>
  );
}
