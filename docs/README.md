# 项目文档

本目录保存跨实验或面向产品开发的长期文档。

- [`product/MVP_DESIGN.md`](product/MVP_DESIGN.md)：攒股收息 MVP 的需求分析。
- [`product/RESEARCH_REVIEW.md`](product/RESEARCH_REVIEW.md)：银行股定投研究评审，判定可否进入产品原型及前置条件。
- [`product/ARCHITECTURE.md`](product/ARCHITECTURE.md)：MVP 技术选型与整体架构（Electron 桌面 / Flutter 安卓 / 本地存储无后端）。
- [`product/ARCHITECTURE_REVIEW.md`](product/ARCHITECTURE_REVIEW.md)：架构师评审结论（总体评估、按优先级的问题清单、长期演进策略、R1 启动前检查清单）。
- [`product/ADR-001-desktop-electron.md`](product/ADR-001-desktop-electron.md)：决策记录——桌面端采用 Electron。
- [`product/ADR-002-android-flutter.md`](product/ADR-002-android-flutter.md)：决策记录——安卓端采用 Flutter（待 spike）。
- [`product/ADR-003-backend-deployment.md`](product/ADR-003-backend-deployment.md)：决策记录——两端均本地存储、无远程后端（桌面 sidecar 仅监听 127.0.0.1）。
- [`product/ADR-004-local-first-data.md`](product/ADR-004-local-first-data.md)：决策记录——Local-first 数据主权（持仓归用户本地）。

研究主线收敛在 `labs/` 下，每个主题为一个独立 Lab 目录（金融数据获取相关材料位于 `labs/00_金融数据获取/`，银行股定投回测位于 `labs/01_银行股定投回测/`）；可复现研究说明位于 `research/<topic>/`，最终研究成稿位于 `reports/`。
