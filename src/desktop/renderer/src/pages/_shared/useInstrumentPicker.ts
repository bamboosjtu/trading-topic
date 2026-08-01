import { useMemo } from "react";
import { Form, type FormInstance } from "antd";
import type { SecurityType, StockInfo } from "../../api/client";
import { securityTypeForInstrument } from "../../../../shared/instruments";

/** 证券目录加载状态。两个 Modal 共享同一形状。 */
export interface InstrumentCatalogStatus {
  loading: boolean;
  error?: string;
}

/** AutoComplete 选项。两个 Modal 共享同一形状。 */
interface InstrumentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface UseInstrumentPickerArgs {
  /** 当前 Modal 的 Form 实例。Hook 会通过 `Form.useWatch("securityType", form)` 跟踪资产类型。 */
  form: FormInstance;
  stocks: readonly StockInfo[];
  catalogStatus: Record<SecurityType, InstrumentCatalogStatus>;
  onRetryCatalog: (type: SecurityType) => void;
  /**
   * 是否在 AutoComplete `onChange` 时也尝试同步 `instrumentName`/`securityType`。
   *
   * 默认 `false`，与 `DividendReinvestmentModal` 既有行为一致：只在
   * `onSelect` 命中完整代码时才回填名称与类型，避免用户输入到一半时
   * 触发不必要的字段覆盖。
   *
   * `LedgerEntryModal` 历史上同时绑定 `onSelect` 与 `onChange`，行为完全
   * 相同，因此传入 `true` 以保留原行为。
   */
  syncOnChange?: boolean;
}

interface UseInstrumentPickerResult {
  /** 当前表单中选中的 `securityType`（可能为 `undefined`）。 */
  securityType: SecurityType | undefined;
  /** 实际生效的 `securityType`（表单未选时回退为 `"stock"`）。 */
  activeSecurityType: SecurityType;
  /** 当前 `securityType` 对应的目录状态。 */
  activeCatalogStatus: InstrumentCatalogStatus;
  /** 用于 AutoComplete 的 options（含加载/错误/空占位）。 */
  displayedSymbolOptions: InstrumentOption[];
  /** 直接展开到 `<AutoComplete {...autoCompleteProps} />` 上。 */
  autoCompleteProps: {
    options: InstrumentOption[];
    filterOption: (input: string, option?: InstrumentOption) => boolean;
    onSelect: (value: string) => void;
    onChange: (value: string) => void;
    onDropdownVisibleChange: (visible: boolean) => void;
  };
}

/**
 * 抽出 `LedgerEntryModal` 与 `DividendReinvestmentModal` 共享的"证券选择"
 * 逻辑：维护 `stockBySymbol` 索引、按 `securityType` 过滤选项、构造加载/
 * 错误/空占位、以及 `AutoComplete` 所需的 `onSelect`/`onChange`/
 * `onDropdownVisibleChange` 回调。
 *
 * Hook 内部调用 `Form.useWatch("securityType", form)`，因此调用方无需
 * 自行 watch；表单字段名固定为 `securityType`、`symbol`、`instrumentName`，
 * 两个 Modal 已统一使用这三个名称。
 */
export function useInstrumentPicker({
  form,
  stocks,
  catalogStatus,
  onRetryCatalog,
  syncOnChange = false,
}: UseInstrumentPickerArgs): UseInstrumentPickerResult {
  // `Form.useWatch` 是 React Hook，必须在自定义 Hook 顶层调用。
  // 这里直接 watch "securityType"，因此 Hook 与该字段名存在约定。
  const securityType = Form.useWatch("securityType", form) as
    | SecurityType
    | undefined;
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
  const activeSecurityType: SecurityType = securityType ?? "stock";
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

  // 命中完整代码时回填名称与资产类型。`onSelect` 与（可选的）`onChange`
  // 共享同一逻辑，确保用户从下拉选择与手工输入完整代码时行为一致。
  const applyStock = (value: string) => {
    const stock = stockBySymbol.get(value);
    if (!stock) return;
    form.setFieldValue("instrumentName", stock.name);
    form.setFieldValue("securityType", securityTypeForInstrument(stock));
  };

  return {
    securityType,
    activeSecurityType,
    activeCatalogStatus,
    displayedSymbolOptions,
    autoCompleteProps: {
      options: displayedSymbolOptions,
      filterOption: (input, option) =>
        Boolean(option?.disabled) ||
        String(option?.label ?? "")
          .toLowerCase()
          .includes(input.toLowerCase()),
      onSelect: applyStock,
      onChange: (value: string) => {
        if (syncOnChange) applyStock(value);
      },
      onDropdownVisibleChange: (visible) => {
        if (
          visible &&
          activeCatalogStatus.error &&
          !activeCatalogStatus.loading
        ) {
          onRetryCatalog(activeSecurityType);
        }
      },
    },
  };
}
