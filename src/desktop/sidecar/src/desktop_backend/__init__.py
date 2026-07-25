"""攒股收息 R1 桌面应用 Python sidecar。

三域隔离约束（见 docs/product/ARCHITECTURE.md §2）：
- 本包不 import `labs/`、`research/`；
- 不读取 labs 或 research 的工作目录作为运行时数据源；
- 拥有独立 pyproject.toml 与 uv.lock，不与 labs/research 共用环境。
"""

__version__ = "0.1.0"
