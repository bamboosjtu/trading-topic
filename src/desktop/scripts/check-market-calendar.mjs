import { readFileSync } from "node:fs";
import { join } from "node:path";

const currentYear = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
}).format(new Date());
const calendarPath = join(
  process.cwd(),
  "electron",
  "data",
  "market-calendar",
  `${currentYear}.json`,
);

let calendar;
try {
  calendar = JSON.parse(readFileSync(calendarPath, "utf8"));
} catch {
  throw new Error(
    `${currentYear} 年交易日历文件不存在或无法解析，拒绝构建发布版本`,
  );
}

if (
  calendar.year !== Number(currentYear) ||
  calendar.status !== "official" ||
  typeof calendar.source !== "string" ||
  !calendar.source
) {
  throw new Error(
    `${currentYear} 年交易日历尚未更新为官方安排，拒绝构建发布版本`,
  );
}

console.log(`${currentYear} 年官方交易日历发布门禁通过`);
