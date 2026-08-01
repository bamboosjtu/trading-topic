/**
 * backtest 页面格式化入口：统一从 _shared/format 复用，
 * 保留本模块作为 backtest 域的稳定导入路径，避免各组件直接依赖 _shared。
 */
export {
  money,
  percent,
  pnlClass,
  beijingDate,
  beijingTimestamp,
} from "../_shared/format";
