/**
 * 构建后把 Pagefind 索引复制到 public/，避免下次 dev 时搜索 404。
 * 用 Node 实现而不是 cp -r，Windows 的 PowerShell / cmd 下也能跑。
 */
import fs from "node:fs";
import path from "node:path";

const from = path.resolve("dist/pagefind");
const to = path.resolve("public/pagefind");

if (!fs.existsSync(from)) {
  console.log("[postbuild] 没有 dist/pagefind，跳过");
  process.exit(0);
}

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log("[postbuild] 已复制搜索索引到 public/pagefind");
