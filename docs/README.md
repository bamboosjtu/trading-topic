# 项目文档

本目录保存跨实验或面向产品开发的长期文档。

## 产品文档（`product/`）

- [`product/PRD_R1.md`](product/PRD_R1.md)：攒股收息 R1 需求、金融口径、验收标准和非目标，含产品定位与范围边界。
- [`product/ARCHITECTURE.md`](product/ARCHITECTURE.md)：R1 单端 Node.js 本地架构、产品域数据适配与工程隔离边界。
- [`product/DESIGN_SYSTEM.md`](product/DESIGN_SYSTEM.md)：桌面端设计系统，把架构层的视觉约束扩展为可执行的界面规则。
- [`product/desktop_ui/`](product/desktop_ui/)：每个一级页面的 UI 设计简述与配套截图。

Labs、Research、Src 三域隔离的完整决策见根目录 [`AGENTS.md`](../AGENTS.md) 与 [`product/ARCHITECTURE.md` §2](product/ARCHITECTURE.md)，不单独维护 ADR 文件。

## 教程资料（`tutorial/`）

`tutorial/` 收录构建 Labs 教程与产物时用到的脚本和说明（如 AKShare 接口体检、筛选与 API 速查），详见 [`tutorial/akshare.md`](tutorial/akshare.md) 末尾说明。

研究主线收敛在 `labs/` 下，每个主题为一个独立 Lab 目录（金融数据获取相关材料位于 `labs/00_金融数据获取/`，银行股定投回测位于 `labs/01_银行股定投回测/`）；可复现研究说明位于 `research/<topic>/`，最终研究成稿位于 `reports/`。
