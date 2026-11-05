const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

test("面经库 keeps 面经: rounds with notes, or who and how — not the App's own notes", () => {
  const labels = read("src/lib/stage-labels.ts");
  for (const prefix of ["网申进度同步", "邮件自动识别：", "从邮件自动记录：", "导入时表格里写的是"]) assert.ok(labels.includes(`"${prefix}"`), prefix);
  const page = read("src/app/(dashboard)/interviews/page.tsx");
  assert.match(page, /\{ note: \{ not: null \}, stage: \{ in: INTERVIEW_LIBRARY_STAGES \} \}/);
  assert.doesNotMatch(page.match(/INTERVIEW_LIBRARY_STAGES: ApplicationStage\[\] = \[[^\]]*\]/)[0], /"APPLIED"|"DECLINED"|"WITHDRAWN"/);
});

test("the new tab offers only jobs still to apply to, one per company", () => {
  const page = read("src/app/(dashboard)/browser/page.tsx");
  assert.match(page, /p\.jdUrl && \(p\.status === "EVALUATING" \|\| p\.status === "PLANNED"\)/);
  assert.match(page, /other\.companyId === p\.companyId/);
});

test("模拟面试 starts from an interview that is coming up; 简历版本 shows how each did", () => {
  const mock = read("src/app/(dashboard)/mock-interview/page.tsx");
  assert.match(mock, /loadUpcomingSchedule\(user\.id, new Date\(now\), 14\)/);
  assert.match(mock, /href=\{`\/mock-interview\?application=\$\{item\.applicationId\}`\}/);
  const resumes = read("src/app/(dashboard)/resumes/page.tsx");
  assert.match(resumes, /row\.applied \+= 1/);
  assert.match(read("src/components/resumes/resume-list.tsx"), /投了 \$\{r\.applied\} 次 · 进面/);
  assert.match(read("src/components/insights/funnel-card.tsx"), /现在停在：/);
});
