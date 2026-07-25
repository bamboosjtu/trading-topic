"""账本领域模型（产品域自有实现）。

需求来源：docs/product/PRD_R1.md §3.2
架构约束：docs/product/ARCHITECTURE.md §6

R1 实现要点（待开发）：
- 七类流水：资金转入、买入、卖出、现金分红、逆回购、资金转出、冲正/修正；
- 追加式记录，已参与计算的记录不原地覆盖；
- 冲正创建反向记录，修正由"冲正原记录 + 新增正确记录"组成；
- 持仓、可用现金、逆回购资产均从有效流水重建，不另存可独立修改的派生余额；
- 输出：当前持仓、可用现金、总资产、累计盈亏、XIRR。

口径定义（PRD §3.2）：
- 总资产 = 持仓市值 + 可用现金 + 未到期逆回购资产
- 累计盈亏 = 总资产 + 累计资金转出 - 累计资金转入
- XIRR：资金转入为负现金流、资金转出为正现金流、数据截止日总资产为期末正现金流

骨架阶段：仅声明流水类型枚举与基础数据结构。
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class EntryType(StrEnum):
    """流水类型（PRD §3.2）。"""

    TRANSFER_IN = "transfer_in"  # 资金转入
    BUY = "buy"  # 买入
    SELL = "sell"  # 卖出
    DIVIDEND = "dividend"  # 现金分红
    REVERSE_REPO = "reverse_repo"  # 逆回购
    TRANSFER_OUT = "transfer_out"  # 资金转出
    ADJUSTMENT = "adjustment"  # 冲正/修正


@dataclass(frozen=True)
class LedgerEntry:
    """流水最小字段集（PRD §3.2）。"""

    entry_id: str  # 唯一编号
    business_date: str  # 业务日期 ISO 8601
    recorded_at: str  # 录入时间 ISO 8601
    currency: str  # R1 固定 CNY
    entry_type: EntryType
    amount: Decimal  # 金额或成交金额
    note: str  # 备注
    source: str  # 创建来源（user / system / import）
    reverses_entry_id: str | None  # 被冲正记录编号（如适用）


def rebuild_positions(entries: list[LedgerEntry]) -> dict[str, int]:
    """从有效流水重建持仓。

    Returns:
        {symbol: 股数}

    Raises:
        NotImplementedError: 骨架阶段未实现
    """
    raise NotImplementedError("账本重建待 R1 开发阶段实现")
