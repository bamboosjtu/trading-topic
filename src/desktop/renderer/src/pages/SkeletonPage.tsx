import { Skeleton } from "antd";
import { useLocation } from "react-router-dom";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/positions": {
    title: "持仓明细",
    description: "正在读取本地持仓与行情估值。",
  },
  "/trades": {
    title: "交易流水",
    description: "正在读取本地资金与证券事实记录。",
  },
  "/income-calendar": {
    title: "收益日历",
    description: "正在生成价格变动与分红收益日历。",
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
