/**
 * 桌面端共享颜色常量。
 *
 * `BRAND_STRONG`（#0d5dc3）是 TS 侧唯一来源，被 tailwind.config.ts
 * （brand.600 / brand.strong）和 theme.ts（colorLink）引用。
 * CSS 侧的 --color-brand-strong 已移除（原为死代码）。
 * `BRAND`（#1677ff）被 tailwind.config.ts（brand.500）和 theme.ts
 * （colorPrimary）引用；CSS 侧 --color-brand 保留供 index.css 使用，
 * 通过注释指向此处保持同步。
 *
 * 详见 docs/product/DESIGN_SYSTEM.md 中 `brand-strong` 的定义。
 */

export const BRAND = "#1677ff" as const;
export const BRAND_STRONG = "#0d5dc3" as const;
