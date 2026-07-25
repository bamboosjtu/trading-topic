# 攒股收息 R1 桌面应用

> 范围与边界以 [docs/product/PRD_R1.md](../../docs/product/PRD_R1.md) 与 [docs/product/ARCHITECTURE.md](../../docs/product/ARCHITECTURE.md) 为准。

## 目录结构

```text
src/desktop/
├── electron/           # Electron 主进程与 preload
├── renderer/           # React + Vite + TS 前端
├── sidecar/            # 本地 Python sidecar（FastAPI，独立 pyproject）
│   ├── src/desktop_backend/
│   └── tests/
└── tests/fixtures/     # 产品自有测试 fixture（带 manifest）
```

三域隔离约束（[ARCHITECTURE.md §2](../../docs/product/ARCHITECTURE.md)）：

- 本目录不 import、不执行、不读取 `labs/`、`research/`；
- sidecar 拥有独立 `pyproject.toml` 与 `uv.lock`，不与 labs/research 共用环境；
- 测试 fixture 必须复制到 `tests/fixtures/` 并带来源与口径 manifest。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面外壳 | Electron + electron-vite |
| 前端 | React 18 + TypeScript + Vite |
| UI | Ant Design 5（ConfigProvider 定制主题）+ Tailwind CSS |
| 路由 | React Router v6 |
| 状态 | Zustand |
| API 缓存 | TanStack Query v5 |
| 图表 | ECharts + echarts-for-react |
| Sidecar | FastAPI + uvicorn |
| 数据库 | SQLite（通过 sidecar 访问，渲染层不直连） |

## 开发命令

```powershell
# 安装前端依赖（国内镜像已在 .npmrc 配置）
npm install

# 开发模式（同时启动 Electron、Renderer、Sidecar）
npm run dev

# 仅启动 Renderer（Vite dev server，便于纯前端调试）
npm run dev:renderer

# 仅启动 Sidecar
uv sync --project src/desktop/sidecar --extra dev
uv run --project src/desktop/sidecar uvicorn desktop_backend.main:app --reload --port 8001

# 类型检查与构建
npm run typecheck
npm run build

# Sidecar 测试
uv run --project src/desktop/sidecar pytest src/desktop/sidecar/tests
```

### 国内镜像配置

`.npmrc` 已配置 npmmirror 镜像源，包含：

- `registry=https://registry.npmmirror.com/`：npm 包镜像
- `electron_mirror=https://npmmirror.com/mirrors/electron/`：Electron 二进制镜像
- `fetch-retries=5`：Windows 网络重试参数

如遇 electron-vite 包安装不完整（`node_modules/electron-vite/dist/` 目录缺失），用以下命令从官方 registry 重装：

```powershell
Remove-Item -Recurse -Force node_modules/electron-vite
npm install electron-vite@2.3.0 --force --registry=https://registry.npmjs.org/
```

## 当前进度

- [x] 骨架结构与配置
- [x] 四个一级页面占位（回测 / 账户 / 流水 / 设置）
- [x] 现代 SaaS 视觉风格基线（主题 token + 布局组件）
- [x] Sidecar `/api/v1/health` 健康检查
- [ ] 领域模块实现（`analysis.py` / `ledger.py` / `corporate_actions.py`）
- [ ] 数据源适配器
- [ ] SQLite 存储与迁移
- [ ] 测试 fixture 转移（从 `research/bank-dca/data/verification.json` 推导）
- [ ] PyInstaller 打包
