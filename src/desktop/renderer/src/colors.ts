/**
 * 桌面端共享颜色常量。
 *
 * `brand-strong`（#0d5dc3）原散落在 tailwind.config.ts（brand.600）、
 * theme.ts（colorLink）、index.css（--color-brand-strong）三处硬编码。
 * 集中到此处后，TS 侧统一引用同一常量，CSS 侧仍保留变量声明但注释
 * 指向此处，避免色值漂移。
 *
 * 详见 docs/product/DESIGN_SYSTEM.md 中 `brand-strong` 的定义。
 */

export const BRAND = "#1677ff" as const;
export const BRAND_STRONG = "#0d5dc3" as const;
