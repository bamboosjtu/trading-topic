"""数据源适配器（产品域自有实现）。

需求来源：docs/product/ARCHITECTURE.md §6
三域约束：本模块不能 import labs/01_银行股定投回测/data_source_registry.py。

允许：
- 在文档中引用 Lab 1 的数据源调查结论；
- 在产品域重新实现行情、证券主数据和公司行动适配器；
- 输出产品自有 schema，每条快照记录来源、获取时间、数据截止时间和转换版本。

骨架阶段：仅声明 schema，具体适配器（akshare/mootdx/直连腾讯/直连新浪）在 R1 开发任务中补全。
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class PriceSnapshot:
    """行情快照（产品自有 schema）。"""

    symbol: str
    date: str  # ISO 8601
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int
    source: str  # 数据源标识（如 "tencent" / "sina"）
    fetched_at: str  # 获取时间 ISO 8601
    data_cutoff: str  # 数据截止日
    schema_version: str  # 转换版本
