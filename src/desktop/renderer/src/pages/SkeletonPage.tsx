import { Skeleton } from "antd";
import { useLocation } from "react-router-dom";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/portfolio-backtest": {
    title: "组合回测",
    description: "用组合权重与再平衡规则验证长期收益和风险。",
  },
  "/symbol-compare": {
    title: "标的对比",
    description: "从收益、回撤与分红维度并排观察候选标的。",
  },
  "/projection": {
    title: "10年视图",
    description: "基于投入与分红假设测算长期资产积累路径。",
  },
  "/overview": {
    title: "资产总览",
    description: "汇总持仓、现金、收益与资产变化。",
  },
  "/positions": {
    title: "持仓明细",
    description: "查看当前持仓数量、成本与估值状态。",
  },
  "/trades": {
    title: "交易流水",
    description: "按时间追踪实际买入、卖出与费用记录。",
  },
  "/dividend-calendar": {
    title: "分红日历",
    description: "集中查看登记日、除权日与分红到账安排。",
  },
  "/cashflow": {
    title: "资金流水",
    description: "追踪资金转入、转出与现金变动。",
  },
  "/drawdown-monitor": {
    title: "回撤监控",
    description: "跟踪持仓回撤区间、持续时间与风险状态。",
  },
  "/data-sources": {
    title: "数据源管理",
    description: "查看行情来源、更新时间和本地快照状态。",
  },
  "/fees": {
    title: "费用与规则",
    description: "管理研究口径、费用模型与计算规则。",
  },
  "/backup": {
    title: "备份与恢复",
    description: "导出或恢复本地研究数据。",
  },
  "/settings": {
    title: "设置",
    description: "管理本地工作台与应用偏好。",
  },
};

export function SkeletonPage() {
  const { pathname } = useLocation();
  const meta = PAGE_META[pathname] ?? {
    title: "功能建设中",
    description: "该模块将在后续版本开放。",
  };

  return (
    <div className="skeleton-page" aria-busy="true" aria-label={`${meta.title}加载中`}>
      <header className="page-heading">
        <h1>{meta.title}</h1>
        <p>{meta.description}</p>
      </header>

      <section className="workspace-panel skeleton-filter">
        <div className="skeleton-filter-fields">
          {[1, 2, 3, 4].map((item) => (
            <div key={item}>
              <Skeleton.Input active size="small" className="!w-20" />
              <Skeleton.Input active className="mt-2 !h-9 !w-full" />
            </div>
          ))}
        </div>
        <Skeleton.Button active className="!h-9 !w-28" />
      </section>

      <section className="workspace-panel skeleton-metrics">
        {[1, 2, 3, 4, 5, 6].map((item) => (
          <div key={item} className="skeleton-metric">
            <Skeleton.Avatar active size={38} />
            <div className="min-w-0 flex-1">
              <Skeleton.Input active size="small" className="!h-3 !w-20" />
              <Skeleton.Input active className="mt-2 !h-6 !w-28" />
            </div>
          </div>
        ))}
      </section>

      <section className="workspace-panel skeleton-chart">
        <div className="flex items-center justify-between">
          <Skeleton.Input active className="!h-6 !w-28" />
          <Skeleton.Button active size="small" className="!w-40" />
        </div>
        <div className="skeleton-chart-lines" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="workspace-panel skeleton-table">
        <Skeleton.Input active className="!h-6 !w-24" />
        <Skeleton
          active
          title={false}
          paragraph={{ rows: 5, width: ["100%", "96%", "100%", "94%", "98%"] }}
        />
      </section>
    </div>
  );
}
