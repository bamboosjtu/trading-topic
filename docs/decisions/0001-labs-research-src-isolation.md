# 0001：Labs、Research、Src 隔离

> 状态：接受
>
> 日期：2026-07-25

## 背景

此前架构计划让 Labs、Research 和产品共同依赖一个顶层业务核心，并曾考虑让产品直接 import Research、复用 Labs 的数据源注册模块。这会把探索代码、研究复现和产品发布绑在同一生命周期中，也使 Research 依赖 Labs 的 Python 环境。

## 决策

1. `labs/`、`research/<topic>/`、`src/desktop/` 不建立源码、运行时、构建时或环境依赖；
2. 每个 Research 主题自带 `pyproject.toml`、`uv.lock`、`src/`、`tests/`、`data/` 和 `report/`；
3. 产品在 `src/desktop/` 内拥有自己的领域实现、数据源适配器、测试 fixture 和发布环境；
4. Labs 只承担探索，不向 Research 或产品暴露可 import 模块；
5. 研究结论进入产品时，以文档化行为契约和带来源的测试向量完成所有权交接，不 import 原研究代码，也不在测试时读取 Research 数据目录；
6. 不创建三个域共同依赖的顶层共享业务核心。

## 结果

收益：

- 任一 Lab 可以重写或删除而不影响研究和产品；
- Research 可以独立复现、冻结和归档；
- 产品发布不受研究目录、Notebook 或实验依赖影响；
- 依赖升级和口径变化的责任边界清晰。

代价：

- 研究实现与产品实现可能存在有意重复；
- 行为契约转移需要人工评审和来源记录；
- 产品必须维护自己的数据适配器和金融计算测试。

这些成本是为隔离生命周期和降低隐式耦合而接受的。

## 验证

- Research 命令只使用本研究项目的环境；
- `src/desktop/` 中不存在指向 `labs/` 或 `research/` 的 import、文件读取或 `PYTHONPATH` 配置；
- 产品 fixture 复制后具有独立 manifest；
- 临时移走 Labs 或 Research 不影响产品构建与测试。
