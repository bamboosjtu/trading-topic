"""回测引擎（产品域自有实现）。

需求来源：docs/product/PRD_R1.md §3.1
架构约束：docs/product/ARCHITECTURE.md §6

R1 实现要点（待开发）：
- 月度固定金额回测；
- 指定日与非交易日顺延（顺延到该月下一个交易日；当月无后续交易日则跳过并标记）；
- 区间首月指定日早于可用数据起点时，从首个满足条件的交易日开始；
- 100 股整数倍买入，剩余现金结转后续月份；
- 买入价格统一采用实际执行交易日的收盘价；
- 简化费用：佣金万分之 2.5，最低 5 元；
- 分红按登记日持股计算，事件日入账并按当日收盘价回购原标的；
- 不支持送股/转增/配股等非现金公司行动，遇到必须阻断或标记"尚未验证"；
- 输出：累计投入、最终资产、累计盈亏、XIRR、最大回撤、累计分红、期末现金。

口径定义（PRD §3.1）：
- 最终资产 = 期末持仓市值 + 期末现金
- 累计盈亏 = 最终资产 - 累计投入
- XIRR：月度外部投入记为负现金流，期末资产记为正现金流；分红属于账户内部现金流，不重复计入
- 最大回撤：基于"持仓市值 + 现金"的日度总资产序列计算
- 累计分红：按实际入账金额累计，不因后续回购而减少

骨架阶段：仅声明接口与数据结构，具体实现在 R1 开发任务中补全。
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable


@dataclass(frozen=True)
class BacktestInput:
    """回测输入参数（PRD §3.1）。"""

    symbol: str  # 6 位 A 股代码
    start_date: str  # ISO 8601
    end_date: str  # ISO 8601
    monthly_amount: Decimal  # 月度固定金额（CNY）
    buy_day: int  # 1-28，指定日；非交易日顺延
    data_cutoff: str  # 数据快照截止日


@dataclass(frozen=True)
class BacktestOutput:
    """回测输出（PRD §3.1 §输出 7 项）。"""

    total_contribution: Decimal  # 累计投入
    ending_asset: Decimal  # 最终资产
    total_pnl: Decimal  # 累计盈亏
    xirr: float  # 年化收益率
    max_drawdown: float  # 最大回撤
    total_dividend: Decimal  # 累计分红
    ending_cash: Decimal  # 期末现金


def simulate_level_dca(
    prices: Iterable[tuple[str, Decimal]],
    dividends: Iterable[tuple[str, Decimal]] | None,
    input_: BacktestInput,
) -> BacktestOutput:
    """月度定投回测。

    Args:
        prices: (日期, 收盘价) 序列，按日期升序
        dividends: (事件日期, 每股分红) 序列；None 表示无分红
        input_: 回测参数

    Returns:
        BacktestOutput

    Raises:
        NotImplementedError: 骨架阶段未实现
    """
    raise NotImplementedError("回测引擎待 R1 开发阶段实现")


def calc_xirr(
    cashflows: Iterable[tuple[str, Decimal]],
) -> float:
    """XIRR（年化收益率）。

    Args:
        cashflows: (日期, 现金流) 序列；负为流出，正为流入

    Raises:
        NotImplementedError: 骨架阶段未实现
    """
    raise NotImplementedError("XIRR 待 R1 开发阶段实现")
