import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const currentYear = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
}).format(new Date());
const calendarDir = join(
  process.cwd(),
  "electron",
  "data",
  "market-calendar",
);

// 收集所有已发布的年度日历
const calendarFiles = readdirSync(calendarDir).filter((f) =>
  f.endsWith(".json"),
);
const calendars = calendarFiles.map((f) => {
  try {
    return JSON.parse(readFileSync(join(calendarDir, f), "utf8"));
  } catch {
    return null;
  }
}).filter(Boolean);

const officialYears = calendars
  .filter((c) => c.status === "official")
  .map((c) => c.year)
  .sort((a, b) => a - b);

// 当前年度门禁
const currentYearCalendar = calendars.find(
  (c) => c.year === Number(currentYear),
);
if (
  !currentYearCalendar ||
  currentYearCalendar.status !== "official" ||
  typeof currentYearCalendar.source !== "string" ||
  !currentYearCalendar.source
) {
  throw new Error(
    `${currentYear} 年交易日历尚未更新为官方安排，拒绝构建发布版本`,
  );
}

console.log(`${currentYear} 年官方交易日历发布门禁通过`);

// 产品支持范围覆盖诊断
const maxBacktestYears = 15;
const currentYearNum = Number(currentYear);
const minBacktestYear = currentYearNum - maxBacktestYears + 1;
const uncoveredYears = [];
for (let y = minBacktestYear; y <= currentYearNum; y++) {
  if (!officialYears.includes(y)) {
    uncoveredYears.push(y);
  }
}

if (uncoveredYears.length > 0) {
  const formatRanges = (years) => {
    const ranges = [];
    let start = years[0];
    let end = years[0];
    for (let i = 1; i < years.length; i++) {
      if (years[i] === end + 1) {
        end = years[i];
      } else {
        ranges.push(start === end ? `${start}` : `${start}—${end}`);
        start = years[i];
        end = years[i];
      }
    }
    ranges.push(start === end ? `${start}` : `${start}—${end}`);
    return ranges.join("、");
  };

  console.warn(
    `警告：最大回测年限 ${maxBacktestYears}，` +
      `当前严格日历覆盖 ${officialYears[0]}—${officialYears.at(-1)}，` +
      `未覆盖 ${formatRanges(uncoveredYears)}`,
  );

  // 严格模式：要求全区间覆盖
  if (process.argv.includes("--require-full-range")) {
    throw new Error(
      `严格模式：产品支持 ${minBacktestYear}—${currentYearNum} 回测，` +
        `但正式日历仅覆盖 ${formatRanges(officialYears)}，` +
        `缺失 ${formatRanges(uncoveredYears)}`,
    );
  }
}
