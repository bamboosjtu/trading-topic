# 攒股收息 R1 修复后评审

> 评审日期：2026-07-30
>
> 范围：`src/desktop/` 架构设计、代码质量与 `docs/product/` 一致性
>
> 发布原则：Labs、Research、Src 保持隔离；MVP 不迁移、不兼容旧代码、旧数据库或旧备份

## 1. 结论

本轮手动发现的 P0-2、P0-3、P1-1、P1-2 均准确；结合全面复核发现的设置页、遗留兼容和全局截止语义问题也已一并修复。

修复后没有发现仍阻断 R1 的已知 P0/P1。当前实现满足：

- 产品域不 import、执行或读取 Labs / Research；
- 跨日分红再投入把未使用分红作为收益归因内部资产；
- 严格回测拒绝任何 `incomplete` 行情尾部且不保存 `completed` 实验；
- 实盘可暂存不完整结果，但明确返回 `partial` 并继续补齐；
- 当前 Schema 2 是唯一数据库与备份基线，不存在迁移、默认补字段或资产类型猜测；
- 设置页、目录 provenance、年度日历诊断和本地维护操作与 PRD 一致；
- 顶栏不再展示语义错误的全局“数据截止日”。

受控真实联网 smoke 仍是发布前的环境性门禁，不属于本轮离线修复的通过证据。

## 2. 手动问题复核与修复

### P0-2：跨日分红再投入区间收益率

**复核：问题原先存在，现已修复。**

`dailyAttribution.ts` 现在从当前有效关联事实重建 `pendingReinvestmentDividendCash`：

1. 关联分红到账增加内部投资现金；
2. 关联买入优先消耗内部现金；
3. 买入超过内部现金的差额才计入外部投入；
4. 未使用余额跨日保留并进入后续资本基数；
5. 修正或冲正后从有效事实重算，不持久化不可审计派生余额。

资本基数统一为：

`期初持仓市值 + 期初待再投入分红现金 + 当日外部新增投入`

新增价格变化测试覆盖 1,000 元股票、100 元分红、次日价格 10→11：

- 第二日资本基数：1,100；
- 第二日收益率：约 9.09%；
- 两日累计收益：20%。

同时覆盖同日再投入、部分再投入后余额跨日、超额买入只计差额、修正与冲正。

### P0-3：严格回测静默接受行情尾部缺失

**复核：两个子问题原先均存在，现已修复。**

行情适配器统一返回：

```ts
interface MarketFetchResult<T> {
  rows: T[];
  requestedThrough: string;
  dataCutoff: string | null;
  tailStatus: "complete" | "confirmed_non_trading" | "incomplete";
  issues: string[];
  provenance: MarketDataProvenance;
}
```

腾讯和新浪现在走相同的格式、区间和尾部校验。新浪非空但尾部不足不会再作为完整结果返回；两源均不完整时只为实盘选择 `dataCutoff` 更新的候选，并保留主源、兜底尝试及失败原因。

消费边界：

- 严格回测：`incomplete` 在公司行动获取、计算和 SQLite 写入前终止，数据库不新增实验；
- 实盘查看：允许保存到实际 `dataCutoff`，状态为 `partial`，未覆盖尾部仍进入下次补齐；
- 法定休市：只有年度 official 交易日历可形成 `confirmed_non_trading`；
- 个股停牌：R1 没有证券级停牌证据源，因此保守保持 `incomplete`；不推断停牌、不沿用前收盘伪造价格行、不缩短实验冒充完成。

测试覆盖腾讯不完整/新浪完整、新浪空、备用源失败、两源均不完整并选择较新截止、跨源冲突、法定休市和严格回测不落库。

### P1-1：ETF 目录 provenance

**复核：问题原先存在，现已修复。**

`fetchDomesticEtfUniverse()` 返回目录行和结构化来源：

- `source`
- `primarySource`
- `fallbackUsed`
- `fallbackReason`
- `fetchedAt`

服务层原样写入 SQLite。设置页分别展示 A 股和 ETF 的实际来源；东方财富失败而新浪成功时，用户可看到新浪实际来源及主源失败原因。

### P1-2：年度交易日历生命周期

**复核：问题原先存在，现已修复。**

- 年度 JSON 显式区分 `official` 与 `pending_official_schedule`；
- 当前年度必须为 official，测试和应用启动均执行门禁；
- 设置页展示年度、状态和来源，对 2027 pending 显示高可见告警；
- pending 年度不猜测工作日休市，空响应保持 unknown / partial；
- PRD、架构和设置页文档明确“官方安排发布后更新年度 JSON”的维护责任。

## 3. 额外 P0/P1 修复

### 设置页

`/settings` 已由永久 Skeleton 替换为真实页面，消费 `health`、`getSettings`、`getDiagnostics`，并提供：

- 当前 Schema、固定费用和计算口径；
- A 股 / ETF 目录 provenance；
- 年度交易日历状态；
- JSON 备份、当前版本备份恢复、脱敏日志导出。

恢复成功后使全部 React Query 查询失效，避免其他页面继续展示恢复前缓存。恢复覆盖前仍由 main 进程生成安全备份并二次确认。

### 清除旧代码、旧数据库和旧备份兼容

- `StockInfo.securityType` 必填；
- 新投资事实缺少资产类型直接拒绝，不再默认股票；
- 删除名称/代码资产类型猜测、`coveredRanges` 和无生产用途的 `replaceStockUniverse()`；
- 唯一数据库基线升级为 Schema 2；
- 数据库同时校验固定发布 fingerprint 和实际 DDL 形状哈希，缺表、缺索引、约束/DDL 变化或指纹不匹配均拒绝；
- Schema 验证通过前不切换 WAL，拒绝旧库时不先修改原文件或创建 WAL；
- 旧版本和同版本损坏数据库保持原文件不变并阻止启动，不迁移、不自动删除；
- 备份必须包含当前设置、工作区字段、资产类型和完整目录 provenance；缺失即在覆盖事务前拒绝。

### 全局截止语义

`HealthResponse` 已删除 `dataCutoff`，顶栏改为“本地模式 · 版本”。当前实验截止、持仓估值截止、收益日历截止和目录更新时间继续由各自页面按真实领域语义展示。

## 4. 架构与代码质量

### 符合发布设计

- Electron 安全边界保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；
- Renderer 不接触 SQLite、文件系统或任意 IPC；
- 金融计算继续位于 `electron/domain/`，数据获取、服务编排和持久化边界清楚；
- 回测试验与行情证据原子提交，失败不留下半份成功实验；
- 分红再投入派生现金不持久化，可由有效事实完整重建；
- Labs / Research / Src 的同类算法仍各自实现，没有建立跨域共享业务核心。

### 仍需关注但不阻断 R1

- `appService.ts` 与 `database.ts` 职责较多；R1 后可按用例拆分，但发布前不建议做无验收收益的大重构；
- `marketDataProvider.ts` 为复用价格/K 线流程仍有泛型转换，现有强类型出口与两类独立校验可控制风险；
- 证券级停牌证据尚未接入。当前保守策略是拒绝严格完成；未来若支持沿用前收盘，必须新增明确证据和独立估值状态，不能伪造交易日行情。

## 5. 文档一致性

以下文档已同步：

- `docs/product/PRD_R1.md`
- `docs/product/ARCHITECTURE.md`
- `docs/product/desktop_ui/本地设置_ui_brief.md`
- `src/desktop/README.md`

文档现已明确：

- 待再投入分红现金的资本基数口径；
- `MarketFetchResult` 与严格回测 / 实盘两种消费规则；
- Schema 2 不迁移、不兼容策略；
- ETF provenance；
- 年度日历生命周期；
- 设置页范围、状态、非目标和验收标准；
- 不存在跨领域统一数据截止日。

## 6. 验证

在 `src/desktop/` 执行：

```powershell
npm run typecheck
npm test
npm run build
```

当前离线测试结果：

- 16 个测试文件通过，1 个受控联网 smoke 文件按默认配置跳过；
- 149 个测试通过，1 个联网 smoke 测试跳过；
- 关键反向测试覆盖 incomplete 严格回测不落库、旧/损坏 Schema 原文件不变、缺字段备份拒绝、目录兜底 provenance 和当前年度日历门禁。

发布前还应在允许联网的受控环境执行：

```powershell
npm run smoke:market-data
```

并审阅生成的 `artifacts/market-data-smoke.json`，不能把默认跳过视为联网验证通过。
