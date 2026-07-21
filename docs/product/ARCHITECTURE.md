# 攒股收息 MVP 技术选型与架构设计

> **配套文档**：`MVP_DESIGN.md`（需求）、`RESEARCH_REVIEW.md`（研究评审）、`ARCHITECTURE_REVIEW.md`（架构评审）
> **设计日期**：2026-07-25
> **最近修订**：2026-07-25（三次评审收敛：可观测性去崩溃上报、API 版本化、Dart 回测引擎口径对齐、安卓 R1 含回测）
> **目标阶段**：原型 R1（详见 `RESEARCH_REVIEW.md` §5.2）

---

## 一、范围与非目标

### 范围

1. 桌面端技术选型：Tauri 与 Electron 深度对比，含 opencode 迁移案例分析；
2. 安卓端技术选型：Flutter / React Native / 小程序候选对比，并在"无后端"约束下确认 Flutter 能力边界；
3. 本地存储与计算架构设计（无远程后端，桌面与安卓各自本地存储）；
4. 项目落地结构与验收标准。

### 非目标

- 不展开 R2 阶段的组合回测、费用模型、估值数据等研究扩展；
- 不评估 iOS / Web / 微信小程序的额外适配（安卓优先）；
- 不涉及实盘交易、券商对接、消息推送等 MVP 之外的能力；
- 不制定开发计划与时间表；
- **不设计远程后端、云同步与跨设备同步**（R1 基线为本地存储 + 显式备份/导入；同步能力延后至 R2 评估，见 `ADR-004`）。

### 核心约束

1. **Python 计算引擎必须复用**：`research/bank-dca/analysis.py` 与 `labs/01_银行股定投回测/bank_dca.py` 已通过测试与口径校核，不得为前端重写；
2. **金融口径不得漂移**：产品输出必须与 `research/bank-dca/data/verification.json` 留档一致；
3. **本地优先（Local-first）**：用户实际持仓数据不得强制上云，符合 `AGENTS.md` 数据安全要求；
4. **无远程后端**：桌面与安卓均采用本地存储，不部署任何服务器，符合 `AGENTS.md` 数据安全要求；
5. **不构成投资建议**：UI 与文案须避免收益承诺语言。

---

## 二、总体架构

采用 **本地优先 + 无远程后端** 的架构：桌面与安卓各自本地存储用户数据，互不依赖网络服务器。**两端均覆盖 MVP 两条主线**（历史回测 + 实际记录）。核心矛盾与处理策略如下：

| 矛盾 | 处理策略 |
|------|----------|
| Python 计算引擎必须复用 vs 安卓无后端 | **桌面端 R1 完整复用 Python 引擎**（sidecar import `analysis.py` / `bank_dca.py`）；**安卓端 R1 用 Dart 重写回测引擎核心计算**（XIRR、`simulate_level_dca`、`rolling_backtest`），数据来自导入的 Parquet/JSON 快照，靠 `tests/golden/` 与 `verification.json` 强制对齐口径 |
| 跨设备数据一致 | R1 不做自动同步，提供**显式备份/导入**（导出带日期戳的归档，导入含冲突策略）；同步能力延后至 R2 评估 |
| 数据源（akshare/mootdx）依赖 Python | 桌面端通过 sidecar 调用；安卓端用**预生成快照**（桌面端导出的 Parquet）+ 在线轻量行情接口（HTTP 直连腾讯/新浪，绕过 akshare） |
| 两端计算口径漂移 | **Python 为金标准，Dart 为运行时实现**；`tests/golden/` 同一输入断言两端输出在容差内一致（nav ≤ 1e-10、XIRR ≤ 1e-6、回撤 ≤ 1e-8） |

```
┌─────────────────────────────┐  ┌─────────────────────────────┐
│  桌面端（Electron）          │  │  安卓端（Flutter）           │
│  ├─ React + ECharts UI       │  │  ├─ Flutter + fl_chart UI    │
│  ├─ 本地 SQLite（持仓/交易） │  │  ├─ 本地 SQLite（持仓/交易） │
│  ├─ 本地 Parquet（行情快照） │  │  ├─ 本地 Parquet（导入快照） │
│  └─ Python sidecar           │  │  └─ Dart 计算层              │
│     ├─ analysis.py（金标准） │  │     ├─ 回测引擎（重写）      │
│     ├─ bank_dca.py           │  │     │   ├─ XIRR              │
│     └─ data_source_registry  │  │     │   ├─ simulate_level_dca│
│                              │  │     │   └─ rolling_backtest  │
│                              │  │     ├─ 持仓/收益/分红计算     │
│                              │  │     └─ 行情快照读取           │
└──────────────┬───────────────┘  └──────────────┬───────────────┘
               │                                  │
               │ 用户显式导出归档                  │ 用户显式导入归档
               │ (.zip: SQLite + Parquet + JSON)  │
               └──────────────┬───────────────────┘
                              │
              ┌───────────────▼───────────────────┐
              │  跨设备一致由用户手动触发           │
              │  R1 不提供自动同步、不部署服务器    │
              └───────────────────────────────────┘
                            │
              ┌─────────────▼─────────────────────┐
              │  tests/golden/ 双端口径防线        │
              │  Python 与 Dart 输出均对照         │
              │  research/bank-dca/data/          │
              │  verification.json                │
              └───────────────────────────────────┘
```

**关键设计**：

- **桌面端**：Electron 主进程 `child_process.spawn` 启动 PyInstaller 编译后的 Python sidecar（FastAPI 监听 `127.0.0.1`，路由统一 `/api/v1/` 前缀），React 前端通过 HTTP 调用本地 sidecar。回测、行情获取、分红计算均在此完成。
- **安卓端**：纯 Flutter 应用，无 Python 依赖。R1 覆盖 `MVP_DESIGN.md` 两条主线——主线一"历史回测"由 Dart 重写的回测引擎执行（输入：导入的 Parquet/JSON 行情快照 + 分红快照；输出：与 Python 引擎在 golden test 容差内一致）；主线二"实际记录"由 Dart 实现持仓/交易/逆回购 CRUD、自动行情补充（HTTP 直连腾讯/新浪轻量接口）、收益与分红计算。
- **数据交换**：两端通过显式归档（`.zip` 包含 `app.db` + `*.parquet` + `manifest.json`）传递数据，无任何自动云同步。桌面端导出的行情/分红快照既可用于安卓端回测，也可用于离线查看。
- **Golden Test 防线**：`tests/golden/` 同一输入同时断言桌面 Python sidecar 与安卓 Dart 计算层输出与 `verification.json` 一致，防止 Dart 重写时口径漂移。详见 §5.7。

---

## 三、桌面端技术选型

### 3.1 候选方案

| 方案 | 体积 | 渲染引擎 | 后端契合 | 生态 |
|---|---|---|---|---|
| **Electron** | 80-200 MB | Chromium（自带） | 内置 Node.js，可直接 `child_process.spawn` Python | 极成熟 |
| **Tauri** | 5-15 MB | 系统 WebView（WebKit/WebView2） | Rust 配置层 + sidecar | 成长中 |
| Flutter Desktop | 20-40 MB | Skia（自带） | HTTP only | 桌面支持仍在成熟 |
| .NET MAUI | 中 | 自带 | 需 IPC 调 Python | Windows 中心 |

实际候选收敛为 **Electron vs Tauri**，其余方案在 Python 后端契合度或生态成熟度上明显劣势。

### 3.2 Tauri vs Electron 深度对比

| 维度 | Tauri | Electron | 说明 |
|---|---|---|---|
| **安装包体积** | 5-15 MB | 80-200 MB | Tauri 优势，但 SSD 普及下 100MB 加载仅约 28ms，用户感知极弱 |
| **内存占用** | 50-80 MB | 200-300 MB | Tauri 优势，但金融工具非后台常驻型，可接受 |
| **启动速度** | 快 | 略慢但可接受 | 两者差距在百毫秒级，非关键路径 |
| **跨平台渲染一致性** | ❌ 三平台三套 WebView | ✅ Chromium 全平台一致 | **Tauri 致命短板**：macOS WKWebView / Linux WebKitGTK / Windows WebView2 行为差异 |
| **图表渲染稳定性** | 依赖系统 WebView | ✅ Chromium 一致 | ECharts 在不同 WebView 上可能有细微差异 |
| **Python 后端集成** | sidecar（spawn 子进程） | `child_process.spawn` | 两者都可行，Electron 更直接 |
| **Node.js 内置** | ❌ 需额外打包 | ✅ 内置 | Electron 可直接跑 JS 后端代码，Tauri 需 Rust 或额外运行时 |
| **学习成本（针对用户）** | 中（Rust 配置层 + Web 前端） | 低（用户已熟悉） | 用户已有 Electron 经验 |
| **生态成熟度** | 成长中（部分插件文档不全） | 极成熟 | Electron 商业案例：VS Code、Slack、Discord、Figma 等 |
| **安全模型** | 默认禁用 Node 集成，权限白名单 | 需手动配置 `contextIsolation` | Tauri 略优，但 Electron 最佳实践已成熟 |
| **自动更新** | `tauri-updater` | `electron-updater` | 两者都有成熟方案 |
| **图表生态** | ECharts/Recharts（Web 通用） | 同左 | 平局，Web 生态共享 |

### 3.3 opencode 迁移案例分析

2026 年 4 月，OpenCode 团队在 dev.to 发表 [Moving OpenCode Desktop to Electron](https://dev.to/brendonovich/moving-opencode-desktop-to-electron-4hip)，宣布从 Tauri 迁回 Electron。Band 应用也于同期启动类似迁移（[band-app/band#306](https://github.com/band-app/band/issues/306)）。

**OpenCode 给出的三个迁移理由**与本项目的相关性：

| OpenCode 理由 | 本项目相关性 | 说明 |
|---|---|---|
| **WebKit 渲染问题** | **高** | macOS/Linux 上 WebKit 性能与 Chromium 有差距，且样式不一致。本项目用 ECharts 渲染 K 线、净值曲线、回撤条带、滚动胜率热力图，对渲染一致性要求高 |
| **CLI 启动瓶颈** | **高** | OpenCode 通过 bundled CLI 启动服务端，Windows 上偶发失败。本项目同样需要 bundled Python 后端，Tauri sidecar 在 Windows 上的启动稳定性是已知痛点 |
| **Bun → Node 迁移** | **中** | OpenCode 把服务端代码从 Bun 迁到 Node，Electron 内置 Node 进程简化了架构。本项目后端是 Python，但 Electron 内置 Node 让前端 ↔ 后端的协调层（如 spawn 管理、健康检查、 graceful shutdown）更简单 |

**OpenCode 团队明确强调**：

> "This decision was carefully considered and is not indicative of one framework being inherently superior or faster, but rather Electron proving to be a better fit for OpenCode's specific use case."

即：Tauri 并非"差"，而是 client-server 架构 + bundled CLI/服务端的场景下，Electron 的契合度更高。本项目正是同一类场景。

### 3.4 体积与性能的常见误区

参考社区分析（[Opencode从Tauri切回Electron](http://m.toutiao.com/group/7660087501876429322/)）：

**误区 1：体积小 = 启动快**
- Tauri 5MB vs Electron 100MB，差 20 倍
- SSD 读取速度 3500-7000 MB/s
- 加载 5MB ≈ 1.4ms，加载 100MB ≈ 28ms
- **差距 26ms，人眼无法感知**

**误区 2：体积小 = 运行快**
- Tauri 的 UI 仍是 TS，只有底层逻辑可用 Rust
- CPU 密集型任务（日志扫描、加解密、压缩）才能发挥 Rust 优势
- 本项目主要工作是展示回测结果（JSON + 图表），把这种处理塞进 Rust 无收益

**误区 3：Tauri 在所有场景都更优**
- Tauri 适合：轻量工具、不需 bundled 服务端、单一平台
- Electron 适合：client-server 架构、需 bundled 服务端、跨平台渲染一致性要求高

### 3.5 推荐：**Electron + React + Apache ECharts**

#### 推荐理由

1. **用户已有 Electron 经验**：学习成本最低，原型迭代最快
2. **opencode 案例验证**：同类型 client-server + bundled 后端架构，Electron 是更优选择
3. **跨平台渲染一致性**：Chromium 全平台行为一致，ECharts 渲染稳定
4. **Python 后端集成简单**：`child_process.spawn` 启动 PyInstaller 编译后的 FastAPI 单可执行，无需 Rust 配置层
5. **生态成熟**：自动更新、签名、安装包（NSIS/DMG）等工程链路完备（崩溃上报链路亦成熟，但本项目按 §5.6 决策不接入）
6. **体积可接受**：金融工具非后台常驻型，100MB 安装包对目标用户无感
7. **未来扩展**：若后续需要 Web 版，Electron 的前端代码可直接复用为 Web 应用

#### 关键依赖

```
electron                  # 主框架
electron-builder          # 打包（NSIS for Windows, DMG for macOS）
electron-updater          # 自动更新
react + react-router      # 前端框架
zustand                   # 状态管理（轻量优先）
echarts + echarts-for-react   # 图表
@tanstack/react-query     # 后端响应缓存
antd 或 shadcn/ui         # UI 组件库（按设计风格定）
pyinstaller               # 把 FastAPI 编译为单可执行
```

#### 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| 内存占用较高（200-300MB） | 金融工具非常驻型，可接受；Electron 22+ 已优化内存 |
| 安全需手动配置 | 强制 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，CSP 白名单 |
| 安装包较大 | 用 `electron-builder` 的 `asar` 打包 + `asarUnpack` 仅解包必要原生模块 |
| Python sidecar 启动失败 | 加入健康检查 + 自动重启 + 友好错误提示（参考 opencode 教训） |

---

## 四、安卓端技术选型

### 4.1 候选方案

| 方案 | 性能 | 图表库 | 跨端扩展 | 学习成本（针对用户） |
|---|---|---|---|---|
| **Flutter** | 接近原生 | fl_chart、syncfusion_flutter_charts | iOS/Desktop/Web | 中（需学 Dart） |
| **React Native** | 中（Bridge） | victory-native、react-native-gifted-charts | iOS | 低（用户已熟悉 JS/TS） |
| **Kotlin + Compose** | 原生 | MPAndroidChart、Vico | 仅 Android | 高（Kotlin + Android 体系） |
| **Taro 小程序** | 中低 | ECharts wx-charts | 微信生态 | 低 |

实际候选收敛为 **Flutter vs React Native**（小程序作为备选验证方案）。

### 4.2 "无后端"约束下的能力边界分析

由于 R1 决策为**两端均本地存储、无远程后端**（见 `ADR-003`），安卓端必须在无 Python 依赖的前提下满足 `MVP_DESIGN.md` 两条主线的需求。下表逐项核对 Flutter 能力边界：

| MVP 需求 | Flutter 是否支持 | 实现方案 | R1 范围 |
|---|---|---|---|
| 持仓/交易/逆回购 CRUD | ✅ 完全支持 | `sqflite` + `drift`（带类型） | R1 |
| 11 项实际记录输出计算 | ✅ 完全支持 | Dart 实现，与 `verification.json` 对齐 | R1 |
| 历史回测（10/5/3 年） | ✅ 支持（Dart 重写） | Dart 重写 `analysis.simulate_level_dca`，输入来自导入的 Parquet/JSON 快照；接入 `tests/golden/` 对齐口径 | R1 |
| 多标的并排比较 | ✅ 支持（Dart 重写） | Dart 实现，对每个标的独立回测后并排汇总 | R1 |
| 滚动窗口回测 | ✅ 支持（Dart 重写） | Dart 重写 `analysis.rolling_backtest`，对 3/5/10 年滚动窗口逐次估值 | R1 |
| 当前市值/行情补充 | ✅ 部分支持 | HTTP 直连腾讯 `qt.gtimg.cn` / 新浪 `hq.sinajs.cn`，**绕过 akshare** | R1 |
| 历史分红查询 | ✅ 部分支持 | 从桌面端导出的 `dividends/*.parquet` 读取 | R1 |
| 预计分红预测 | ⚠️ 简化支持 | 基于历史分红均值推算，不做精算 | R1 简化版 |
| 国债逆回购计息 | ✅ 完全支持 | Dart 实现，公式与 `analysis.py` 一致 | R1 |
| 备份/导入 | ✅ 完全支持 | 文件选择 + zip 解压 + SQLite 替换 | R1 |
| 底部四 Tab + FAB | ✅ 完全支持 | Material 3 原生组件 | R1 |
| K 线、净值曲线、回撤条带、滚动胜率热力图 | ✅ 支持 | `fl_chart` 定制；R1 直接渲染 Dart 回测引擎的输出 | R1 |

**结论**：在"无后端"约束下，**Flutter 能满足 R1 安卓端 MVP 两条主线的全部需求**。历史回测通过 Dart 重写 `analysis.py` 核心计算实现，输入数据来自桌面端导出的 Parquet/JSON 快照（行情 + 分红），输出通过 `tests/golden/` 与 Python 金标准对齐。这是用户决策（2026-07-25）：MVP 核心是两条主线——回测选股与收息实盘，安卓端不可只做"实际记录"半条主线。

### 4.3 Flutter vs React Native 深度对比

| 维度 | Flutter | React Native | 说明 |
|---|---|---|---|
| **性能** | ✅ Dart AOT 编译，无 Bridge | ⚠️ Bridge 开销（New Architecture 改善中） | Flutter 在长列表、复杂图表场景更流畅 |
| **金融图表能力** | ✅ fl_chart 高度自定义，syncfusion 提供专业金融图 | ⚠️ victory-native 可用但定制成本高 | 本项目需要 K 线、净值曲线、回撤条带、滚动胜率热力图 |
| **与桌面端栈统一** | ❌ Dart vs JS/TS | ✅ 同为 JS/TS | 若桌面用 Electron，RN 可共享语言与部分代码 |
| **本地 SQLite** | ✅ `sqflite` + `drift` 成熟 | ✅ `react-native-sqlite-storage` 成熟 | 平局 |
| **Parquet 读取** | ⚠️ `parquet_dart` 不成熟，需评估 | ⚠️ 需 `arrow-js` 或原生模块 | 两端都需 spike；备选方案：导出时同步生成 JSON 副本 |
| **HTTP 直连行情** | ✅ `dio` 成熟 | ✅ `axios` 成熟 | 平局 |
| **Material 3 支持** | ✅ 原生支持 | ⚠️ Paper 3 支持中 | MVP 底部四 Tab + 右下角 "+" 契合 Material Design |
| **iOS 扩展** | ✅ 零成本 | ✅ 零成本 | 平局 |
| **桌面扩展** | ✅ Flutter Desktop（仍在成熟） | ❌ 官方不支持 | 若未来考虑桌面备份方案，Flutter 更优 |
| **生态成熟度** | ✅ Google 主推，活跃 | ✅ Meta 主推，活跃 | 平局 |
| **学习成本（针对用户）** | 中（Dart 对 JS 开发者易上手） | 低（用户已熟悉） | RN 有学习成本优势 |

### 4.4 推荐：**Flutter + fl_chart + dio + drift**（首选）

#### 推荐理由

1. **图表能力是金融应用的核心**：K 线、净值曲线、回撤条带、滚动胜率热力图对图表库的定制能力要求高，`fl_chart` 与 `syncfusion_flutter_charts` 显著优于 RN 生态
2. **性能优势在数据密集场景明显**：回测结果可能包含数百个滚动窗口，Flutter 在长列表滑动、图表缩放等交互上更流畅
3. **Material 3 原生支持**：MVP 的底部四 Tab + 右下角 "+" 是典型 Material Design 模式
4. **未来扩展灵活**：单代码库可零成本扩展 iOS，甚至桌面备份方案
5. **Dart 对 JS 开发者友好**：语法接近，类型系统类似 TypeScript，学习曲线可控
6. **本地存储生态成熟**：`sqflite` + `drift` 提供 类型安全的 SQLite ORM，契合 Local-first 数据主权原则

#### R1 安卓端能力边界（必须明确）

- ✅ **主线一：历史回测**（Dart 重写引擎）
  - 单标的回测：Dart 重写 `analysis.simulate_level_dca`，输入来自导入的 Parquet/JSON 行情快照
  - 多标的并排比较：对每个标的独立回测后并排汇总
  - 滚动窗口回测：Dart 重写 `analysis.rolling_backtest`，对 3/5/10 年滚动窗口逐次估值
  - 核心输出：累计投入、最终资产、累计收益率、年化收益率（XIRR）、最大回撤、累计分红
  - 数据来源：桌面端导出的 `prices/*.parquet` + `dividends/*.parquet`，或安卓端 HTTP 直连腾讯/新浪拉取历史行情
- ✅ **主线二：实际记录**
  - 持仓/交易/逆回购 CRUD、11 项输出计算、国债逆回购计息
  - 行情补充：HTTP 直连腾讯/新浪轻量接口（绕过 akshare）
- ✅ **备份/导入**：zip 归档导入导出（含行情/分红快照，供回测使用）

#### Dart 回测引擎重写要点（详见 §5.7）

1. **XIRR**：Dart 实现牛顿法（对齐 `analysis.calc_xirr`），容差 ≤ 1e-6
2. **`simulate_level_dca`**：Dart 重写一手买入回测，金额用 `fixed` 包（对齐 Python `Decimal`），nav 容差 ≤ 1e-10
3. **`rolling_backtest`**：Dart 重写滚动窗口，回撤容差 ≤ 1e-8
4. **Golden Test**：`tests/golden/` 同一输入断言 Dart 与 Python 输出在容差内一致，对照 `research/bank-dca/data/verification.json`

#### 备选触发条件

若用户优先考虑**栈统一**（与桌面 Electron 共享 JS/TS 知识、组件模式、API 客户端代码），可选 **React Native + victory-native**。代价是图表定制成本上升，长列表性能需用 `FlashList` + `Reanimated 3` 优化；同时 RN 也需重写回测引擎（TypeScript 实现），golden test 同样适用。

#### R1 前 spike 清单（必须在 R1 启动前完成）

1. **`fl_chart` 滚动胜率热力图样例**：用真实回测数据（来自 `research/bank-dca/data/verification.json`）实现一张滚动胜率热力图，验证交互性能与定制能力
2. **`parquet_dart` 读取验证**：用桌面端导出的 `prices/*.parquet` 与 `dividends/*.parquet` 测试读取，若不成熟则改为同步导出 JSON 副本
3. **`drift` schema 与桌面 SQLite 一致性**：验证两端可读写同一份 `app.db`
4. **HTTP 直连腾讯/新浪行情**：验证 `qt.gtimg.cn` / `hq.sinajs.cn` 在安卓上的可用性与限流策略
5. **Dart XIRR 与 Python 对齐**：用 `verification.json` 的 7 行资产数据，验证 Dart 牛顿法 XIRR 与 Python 输出误差 ≤ 1e-6

#### MVP 页面映射（参考 `MVP_DESIGN.md#L120-L128`）

```
BottomNavigationBar
├─ 回测 Tab   → /backtest/create（选择标的 + 区间 + 金额，执行 Dart 回测）、/backtest/list、/backtest/detail
├─ 持有 Tab   → /holdings/overview, /holdings/positions
├─ 收息 Tab   → /dividends/calendar, /dividends/forecast
└─ 我的 Tab   → /settings/sources, /settings/fees, /settings/backup, /settings/import

FloatingActionButton "+" → BottomSheet 选择记录类型
  ├─ 资金转入
  ├─ 买入
  ├─ 卖出
  ├─ 国债逆回购
  ├─ 资金转出
  └─ 手工调整
```

---

## 五、本地存储与计算架构

### 5.1 桌面端架构（Electron + Python sidecar）

```
开发模式：
  Electron (React Dev) ──HTTP──→ FastAPI (uvicorn, hot reload, 127.0.0.1:8000)

生产模式：
  Electron 主进程
    └─ child_process.spawn(pyinstaller_bundle)
         └─ FastAPI (uvicorn, 监听 127.0.0.1:<random_port>)
              ├─ import analysis.simulate_level_dca   # 研究引擎（金标准）
              ├─ import bank_dca                       # Lab 1 一手买入回测
              └─ import data_source_registry           # 双源路由
```

**API 版本化**（评审 P3 收敛）：所有 sidecar 路由统一 `/api/v1/` 前缀，为引擎 baseline 变更（如碎股→一手、费用模型升级）预留不兼容升级空间。版本前缀由 FastAPI `APIRouter(prefix="/api/v1")` 统一注入，OpenAPI schema 自动生成并共享给前端与安卓端。

FastAPI 应用结构（仅运行于桌面端本地 sidecar 内）：

```
src/desktop_server/
├── main.py                  # FastAPI 入口，挂载 /api/v1 前缀
├── api/
│   ├── backtest.py          # /api/v1/backtest/*（桌面端独有，调用 Python 引擎）
│   ├── holdings.py          # /api/v1/holdings/*（CRUD + 11 项输出）
│   ├── dividends.py         # /api/v1/dividends/*
│   └── data.py              # /api/v1/data/*（行情、估值查询）
├── core/
│   ├── engine.py            # 包装 analysis.simulate_level_dca（防腐层）
│   ├── fees.py              # 简化/精确费用模型（R2）
│   ├── repo_interest.py     # 剩余现金逆回购计息
│   └── valuation.py         # PE/PB/股息率分位（R2）
├── db/
│   ├── models.py            # SQLAlchemy 模型（持仓、交易、逆回购）
│   ├── session.py           # SQLite 连接（本地文件 app.db）
│   └── migrations/          # Alembic
└── adapters/
    ├── akshare_adapter.py   # 复用 labs/01_银行股定投回测/data_source_registry.py
    └── snapshot.py          # Parquet 快照读写
```

### 5.2 安卓端架构（纯 Flutter，无 Python 依赖，含 Dart 回测引擎）

```
apps/android/
├── lib/
│   ├── main.dart
│   ├── data/
│   │   ├── database.dart        # drift 数据库定义（与桌面 SQLite schema 一致）
│   │   ├── daos/                # 持仓、交易、逆回购 DAO
│   │   └── snapshot_reader.dart # 读取桌面端导出的 Parquet/JSON 快照
│   ├── domain/
│   │   ├── backtest/
│   │   │   ├── engine.dart      # Dart 回测引擎（重写 analysis.simulate_level_dca）
│   │   │   ├── xirr.dart        # Dart XIRR（牛顿法，对齐 analysis.calc_xirr）
│   │   │   ├── rolling.dart     # Dart 滚动窗口（对齐 analysis.rolling_backtest）
│   │   │   └── types.dart       # BacktestInput/Output 数据类
│   │   ├── portfolio_calc.dart  # 11 项输出计算（Dart，与 verification.json 对齐）
│   │   ├── repo_interest.dart   # 国债逆回购计息（Dart）
│   │   └── dividend_forecast.dart # 分红预测（简化版）
│   ├── adapters/
│   │   ├── tencent_quote.dart   # HTTP 直连 qt.gtimg.cn
│   │   ├── sina_quote.dart      # HTTP 直连 hq.sinajs.cn
│   │   └── history_fetcher.dart # 拉取历史行情供回测使用
│   └── ui/
│       ├── pages/               # 四 Tab + FAB
│       └── widgets/charts/      # fl_chart 定制组件
├── pubspec.yaml
└── android/
```

**Dart 回测引擎调用链**：

```
用户在 /backtest/create 选择标的 + 区间 + 金额
  → history_fetcher.dart 从本地 Parquet/JSON 快照读取行情（或 HTTP 直连拉取）
  → engine.dart 执行 simulate_level_dca（Dart 重写）
     ├─ xirr.dart 计算年化收益率
     ├─ 分红再投资原标的
     └─ 输出 BacktestOutput（累计投入、最终资产、XIRR、回撤、累计分红等）
  → fl_chart 渲染图表
```

### 5.3 两端共享约定

1. **SQLite schema 一致**：桌面用 SQLAlchemy + Alembic，安卓用 drift；两端 `app.db` 文件可互导。schema 由 `docs/product/DATA_MODEL.md`（R1 内补充）单一来源定义
2. **Parquet 快照格式一致**：桌面端 `data_fetch.py` 产出的 `prices/*.parquet`、`dividends/*.parquet` 与安卓端 `snapshot_reader.dart` 读取的格式完全一致；若 `parquet_dart` 不成熟，导出时同步生成 JSON 副本
3. **金额精度统一 `Decimal`**：账户金额（现金、费用、市值）桌面用 `Decimal`（Python `decimal` 模块），安卓用 `fixed` 包；XIRR 等统计量可用 `double`
4. **API 路径与 schema 对齐**：桌面 sidecar 的 `/api/v1/holdings/*` 与安卓本地 `daos/*` 接口签名对齐（同一份 OpenAPI schema 描述），未来若引入远程后端可平滑迁移
5. **数据源降级路径**：复用 `labs/01_银行股定投回测/data_source_registry.py` 的双源路由逻辑，安卓端在 `tencent_quote.dart` / `sina_quote.dart` 中实现等价降级

### 5.4 桌面端 Python sidecar 打包方案

```
打包流程：
1. uv run --project labs pyinstaller --onefile src/desktop_server/main.py
   生成单可执行文件 desktop_server.exe
2. electron-builder 把该可执行作为 extraResource 打入安装包
3. Electron 主进程启动时 spawn 该可执行，等待健康检查通过后加载前端
4. 健康检查失败时进入降级模式：仅 UI 可用，回测/数据获取禁用并提示用户
```

sidecar 生命周期状态机（参考评审 P1）：

```
starting → healthy → degraded → restarting → failed
   │          │         │           │           │
   │          │         │           │           └─ 显示错误 + 一键重启
   │          │         │           └─ 自动重启（最多 3 次）
   │          │         └─ 数据源降级，UI 标记
   │          └─ 正常服务
   └─ 启动中，前端显示加载状态
```

### 5.5 备份/恢复设计（评审 P2 收敛）

- **备份内容**：`app.db`（用户持仓/交易/逆回购）+ `config.json`（数据源、费用模板）+ 可选的 `snapshots/*.parquet`（行情/分红快照，可重建，默认不打包）
- **归档格式**：`backup_YYYYMMDD_HHMMSS.zip`，内含 `manifest.json`（版本、来源、口径、生成端）
- **导入冲突策略**：覆盖 / 合并 / 取消；合并时按主键去重，冲突字段保留较新时间戳
- **跨端导入**：桌面导出的 zip 可在安卓导入；反之亦然。schema 不兼容时 manifest 中标注版本，前端提示升级或拒绝

### 5.6 可观测性（评审 P2 收敛）

**用户决策（2026-07-25）：结构化日志，不接入崩溃上报服务。**

#### 设计原则

- **本地优先**：日志写入本地文件 + 控制台，不上传任何远端服务
- **可复盘**：用户报"数字不对"时，可让用户提供日志文件辅助排查
- **不泄露**：日志不得打印持仓、金额、账号等敏感字段；错误信息中也要避免泄露密钥（呼应 `AGENTS.md` 数据安全要求）
- **崩溃不自动上报**：崩溃堆栈仅写入本地日志，不接入 Sentry / Crashlytics 等远端服务

#### 桌面端可观测性

```
src/desktop_server/
└── observability/
    ├── logger.py          # 结构化日志（JSON 格式），写入 %APPDATA%/app/logs/sidecar.log
    └── request_id.py      # 每次请求注入 request_id，串联日志链路

apps/desktop/electron/
└── main/
    └── logger.ts          # Electron 主进程日志，写入 %APPDATA%/app/logs/desktop.log
```

日志字段：`timestamp`、`level`、`request_id`、`module`、`event`、`duration_ms`、`error_type`（不含堆栈正文中的敏感数据）

#### 安卓端可观测性

```
apps/android/lib/
└── observability/
    ├── logger.dart        # 结构化日志，写入应用沙箱 logs/app.log
    └── crash_handler.dart # 捕获未处理异常，写入 logs/crash.log（仅本地，不上报）
```

#### 日志保留策略

- 单文件上限 10MB，滚动保留最近 5 个文件
- 用户可在"我的 → 诊断"页面导出日志 zip（脱敏后）
- 默认保留 30 天，超期自动清理

### 5.7 Dart 重写回测引擎的口径对齐方案（评审新增项）

**问题背景**：安卓端无 Python 依赖，必须用 Dart 重写 `research/bank-dca/analysis.py` 的核心计算。Dart 与 Python 在浮点数、Decimal 实现、算法收敛条件上的差异可能导致口径漂移，使两端对同一组输入产出不同结果，破坏研究结论的可复现性。

#### 口径漂移的三个来源与对策

| 漂移来源 | Python 实现 | Dart 实现 | 对策 |
|---|---|---|---|
| **金额精度** | `decimal.Decimal`（任意精度） | `fixed` 包（定点小数，默认 2 位小数） | 金额用 `Fixed` 存储；中间计算保留足够精度；XIRR 等统计量可用 `double` |
| **XIRR 算法** | `analysis.calc_xirr` 牛顿法 + `bank_dca.xirr` 二分法 | 统一采用牛顿法（对齐 `analysis.calc_xirr`） | 同一算法、同一收敛阈值（`tol=1e-10`、`max_iter=100`） |
| **浮点比较** | Python `float`（IEEE 754 double） | Dart `double`（IEEE 754 double） | 同一 IEEE 754 标准；nav 比较用容差 `1e-10` 而非严格相等 |

#### Golden Test 防线

`tests/golden/` 是口径对齐的**强制防线**，必须同时覆盖两端：

```
tests/golden/
├── fixtures/
│   ├── prices_600036.csv          # 测试输入：行情快照
│   ├── dividends_600036.csv       # 测试输入：分红快照
│   └── expected_output.json       # 期望输出：来自 Python 引擎 + verification.json
├── test_python_engine.py          # 桌面 sidecar 输出 vs expected_output.json
├── test_dart_engine.dart          # 安卓 Dart 引擎输出 vs expected_output.json
└── README.md                      # 容差与运行说明
```

#### 容差定义

| 指标 | 容差 | 说明 |
|---|---|---|
| `nav_identity_max_error` | ≤ 1e-10 | 标的总回报净值与现金流调整后策略净值的等价性误差 |
| `xirr` | ≤ 1e-6 | 年化收益率（XIRR）误差 |
| `max_drawdown` | ≤ 1e-8 | 最大回撤误差 |
| `total_return` | ≤ 1e-10 | 累计收益率误差 |
| `ending_asset` | ≤ 1e-8 | 最终资产误差（金额精度受限） |

容差来源：`research/bank-dca/data/verification.json` 显示 Python 双实现（牛顿法 vs 二分法）的 `nav_identity_max_error` ≤ 1.2e-14；Dart 重写允许更宽松的容差以容纳 Decimal/fixed 精度差异，但仍远小于用户可感知范围（0.01 元）。

#### 对齐流程

1. **R1 启动前**：用 `verification.json` 的 7 行资产数据作为 golden test 输入，验证 Dart XIRR 与 Python 误差 ≤ 1e-6
2. **R1 开发中**：每实现一个 Dart 计算函数，立即在 `tests/golden/` 增加对应测试
3. **R1 验收**：`tests/golden/` 全部通过，两端输出在容差内一致
4. **长期维护**：Python 引擎升级时，先更新 `expected_output.json`，再修复 Dart 实现至通过

---

## 六、项目落地结构

遵循 `AGENTS.md` "产品开发 → `docs/product/`，后续按需增加 `src/`、`tests/` 或 `apps/`" 的约定。

```
trading-topic/
├── docs/product/
│   ├── MVP_DESIGN.md           # 已有，需求
│   ├── RESEARCH_REVIEW.md      # 已有，研究评审（仅评审 labs/）
│   ├── ARCHITECTURE.md         # 本文档
│   ├── ARCHITECTURE_REVIEW.md  # 架构评审
│   ├── ADR-001 ~ ADR-004.md    # 决策记录
│   └── DATA_MODEL.md           # R1 内补充：SQLite schema 单一来源
├── src/
│   └── desktop_server/         # 桌面端 Python sidecar（仅桌面用，见 §5.1）
│       ├── api/
│       ├── core/
│       ├── db/
│       ├── adapters/
│       └── observability/      # 结构化日志（见 §5.6）
├── apps/
│   ├── desktop/                # Electron + React
│   │   ├── src/                # React 前端
│   │   ├── electron/           # 主进程、preload、Python sidecar 管理
│   │   └── package.json
│   └── android/                # Flutter（无 Python 依赖，含 Dart 回测引擎，见 §5.2）
│       ├── lib/
│       │   ├── domain/backtest/  # Dart 回测引擎（重写 analysis.py）
│       │   └── observability/    # 结构化日志（见 §5.6）
│       ├── pubspec.yaml
│       └── android/
├── tests/
│   ├── core/                   # 桌面 sidecar 引擎包装层测试
│   ├── android_domain/         # 安卓 Dart 计算层测试（含回测引擎）
│   ├── api/                    # 桌面 FastAPI 端到端
│   └── golden/                 # 两端输出与 research/bank-dca 数值一致性校验（见 §5.7）
├── labs/                       # 保留，研究主线不动
│   ├── 00_金融数据获取/         # 数据源架构、akshare 体检与筛选脚本
│   └── 01_银行股定投回测/       # Lab 1 银行股定投回测完整链路 + data_source_registry
├── research/bank-dca/          # 保留，作为产品引擎的"金标准"对照
└── reports/                    # 保留
```

**关键约束**：

- `tests/golden/` 必须断言：`src/desktop_server/core` 输出的 XIRR、回撤、最终资产与 `research/bank-dca/data/verification.json` 一致；`apps/android/lib/domain/backtest/` 的 Dart 回测引擎也接入同一组 golden 测试，防止 Dart 重写时口径漂移（容差见 §5.7）
- `src/desktop_server/core/` 不得直接复制 `research/bank-dca/analysis.py`，而是通过依赖安装或在 sidecar 中作为可导入模块
- 桌面端 Python sidecar 打包时，须用 `pyinstaller` 把 FastAPI 编译为单可执行，避免要求用户装 Python
- `apps/android/` 不得引入任何 Python 依赖（不接受 chaquopy、Termux 等方案作为 R1 基线）；回测引擎用 Dart 重写
- `apps/desktop/` 与 `apps/android/` 互相独立，分别构建与发布；两端通过显式备份/导入交换数据
- 所有 sidecar API 路由统一 `/api/v1/` 前缀（见 §5.1）
- 结构化日志写入本地文件，**不接入崩溃上报服务**（见 §5.6）

---

## 七、验收标准与风险

### 7.1 验收标准

#### 桌面端（Electron）

- [ ] Electron 主进程能 spawn Python sidecar 并通过健康检查
- [ ] sidecar 生命周期状态机（starting → healthy → degraded → restarting → failed）实现完整
- [ ] 用户安装包无需预装 Python 即可运行
- [ ] ECharts 渲染的 5 张图（XIRR 柱状图、总回报路径、风险比较、分红影响、滚动胜率热力图）与研究包图表视觉一致
- [ ] `tests/golden/` 通过，桌面 sidecar 输出与 `verification.json` 一致
- [ ] 所有 API 路由统一 `/api/v1/` 前缀，OpenAPI schema 可导出
- [ ] 结构化日志写入本地文件，不接入崩溃上报服务
- [ ] Windows / macOS 安装包均能正常启动（Linux 可选）
- [ ] 备份导出 zip 可在安卓端成功导入

#### 安卓端（Flutter）

- [ ] 底部四 Tab + 右下角 "+" 入口完整
- [ ] 持仓/交易/逆回购 CRUD 完整，11 项实际记录输出可计算
- [ ] **Dart 回测引擎可用**：单标的回测、多标的并排、滚动窗口回测均可在安卓端原生执行
- [ ] `tests/golden/` 通过，Dart 回测引擎输出与 `verification.json` 在容差内一致（nav ≤ 1e-10、XIRR ≤ 1e-6、回撤 ≤ 1e-8）
- [ ] `drift` schema 与桌面 SQLite 完全一致，桌面导出的 `app.db` 可直接读
- [ ] 从桌面导入的 Parquet/JSON 快照可作为回测输入，也可渲染为图表（500+ 滚动窗口 60fps）
- [ ] fl_chart 渲染的净值曲线、回撤条带与桌面端 ECharts 数值一致
- [ ] HTTP 直连腾讯/新浪行情接口可用，数据源降级路径（腾讯 → 新浪）可触发
- [ ] 备份导入 zip 可成功还原 SQLite + Parquet 快照
- [ ] 结构化日志写入本地文件，不接入崩溃上报服务
- [ ] APK 在 Android 10+ 真机可正常安装运行，**无任何 Python 依赖**

#### 后端（桌面 FastAPI sidecar）

- [ ] `/api/v1/backtest/run` 返回结果与 `simulate_level_dca` 输出一致
- [ ] `/api/v1/holdings/*` CRUD 完整，11 项实际记录输出可计算
- [ ] SQLite 数据库迁移可向前兼容（Alembic，"只加列、不删改语义"）
- [ ] 数据源降级路径（腾讯主源 → 新浪备源）可触发并返回 `{status:"degraded", source:"backup"}`

### 7.2 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Electron 内存占用偏高 | 桌面端体验 | 用 Electron 22+ 优化内存；金融工具非常驻型，可接受 |
| Python sidecar 启动失败 | 桌面端无法使用 | 健康检查 + 自动重启 + 降级模式 + 友好错误提示（参考 opencode 教训） |
| 安卓端 `parquet_dart` 不成熟 | 快照读取失败 | spike 验证；备选方案：桌面端导出时同步生成 JSON 副本 |
| Flutter 图表定制成本 | 开发周期 | 优先用 `fl_chart` 内置组件；`syncfusion_flutter_charts` 商业授权需评估 |
| 两端栈不统一（JS/TS + Dart + Python） | 维护成本 | 共享 OpenAPI schema 描述接口契约；`tests/golden/` 强制数值一致 |
| Dart 重写回测引擎口径漂移 | 数据错误 | `tests/golden/` 同时断言 Python 与 Dart 输出与 `verification.json` 一致（容差见 §5.7）；R1 前 spike 验证 XIRR 对齐 |
| 安卓端回测性能不足 | 用户体验 | Dart AOT 编译性能接近原生；500+ 滚动窗口在 fl_chart 中可流畅渲染；必要时分批计算 |
| ETF / 费用 / 估值 R2 需求 | 范围蔓延 | 严格按 R1 范围执行，R2 需求列入 backlog |

### 7.3 待决策问题

1. **桌面端 UI 库**：`antd`（中后台风格成熟）vs `shadcn/ui`（现代极简）？建议按目标用户审美定
2. **Python sidecar 打包工具**：PyInstaller（成熟但产物大）vs Nuitka（编译为 C，更快但配置复杂）？原型阶段用 PyInstaller，性能瓶颈再评估 Nuitka
3. **安卓端 Parquet 读取方案**：`parquet_dart` 是否足够成熟？spike 后决定是否引入 JSON 副本导出
4. **Dart 回测引擎口径对齐失败时的降级策略**：若 R1 前 spike 验证 Dart XIRR 或 `simulate_level_dca` 与 Python 误差超出容差（见 §5.7），需决定是投入更多时间修复 Dart 实现，还是临时降级为"安卓端回测由桌面端 sidecar 完成、安卓端只读查看"——后者违背"MVP 两条主线"产品决策，需重新评审
