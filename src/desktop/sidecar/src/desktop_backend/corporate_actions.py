"""公司行动处理（产品域自有实现）。

需求来源：docs/product/PRD_R1.md §3.1 分红与公司行动
架构约束：docs/product/ARCHITECTURE.md §6

R1 实现要点（待开发）：
- 现金分红事件标准化；
- 登记日持股数量判断；
- 分红入账和原标的回购指令；
- 对 R1 不支持的公司行动（送股/转增/配股等）显式阻断或告警。

骨架阶段：仅声明公司行动类型枚举。
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class CorporateActionType(StrEnum):
    """公司行动类型。

    R1 仅支持 CASH_DIVIDEND；其他类型必须阻断或告警。
    """

    CASH_DIVIDEND = "cash_dividend"  # 现金分红
    STOCK_DIVIDEND = "stock_dividend"  # 送股（R1 不支持）
    STOCK_SPLIT = "stock_split"  # 转增（R1 不支持）
    RIGHTS_ISSUE = "rights_issue"  # 配股（R1 不支持）


@dataclass(frozen=True)
class CorporateActionEvent:
    symbol: str
    event_type: CorporateActionType
    record_date: str  # 登记日 ISO 8601
    event_date: str  # 事件日 ISO 8601
    per_share_amount: Decimal  # 每股分红（CNY）


def is_supported(action: CorporateActionEvent) -> bool:
    """判断 R1 是否支持该公司行动。"""
    return action.event_type == CorporateActionType.CASH_DIVIDEND
