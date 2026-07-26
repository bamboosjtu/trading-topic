# 项目文档

本目录保存跨实验或面向产品开发的长期文档。

- [`product/PRODUCT_BRIEF.md`](product/PRODUCT_BRIEF.md)：攒股收息的产品定位、R1 目标和范围边界。
- [`product/PRD_R1.md`](product/PRD_R1.md)：R1 需求、金融口径、验收标准和非目标。
- [`product/ARCHITECTURE.md`](product/ARCHITECTURE.md)：R1 单端 Node.js 本地架构、产品域数据适配与工程隔离边界。
- [`decisions/0001-labs-research-src-isolation.md`](decisions/0001-labs-research-src-isolation.md)：Labs、Research、Src 的隔离决策。

研究主线收敛在 `labs/` 下，每个主题为一个独立 Lab 目录（金融数据获取相关材料位于 `labs/00_金融数据获取/`，银行股定投回测位于 `labs/01_银行股定投回测/`）；可复现研究说明位于 `research/<topic>/`，最终研究成稿位于 `reports/`。
