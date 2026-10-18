/**
 * 构建前准备静态资源。
 *
 * public/default-og.jpg 是二进制文件，以 base64 存在 scripts/default-og.jpg.b64，
 * 构建时解码出来。这样仓库里全是文本文件，任何平台都能构建，不用把图片塞进提交。
 *
 * 想换图：改 scripts/make-og.mjs 重新生成（需要 Windows 中文字体），
 * 或者直接替换 public/default-og.jpg 后跑：
 *   base64 -w 0 public/default-og.jpg > scripts/default-og.jpg.b64
 */
import fs from "node:fs";
import path from "node:path";

const target = path.resolve("public/default-og.jpg");
const source = path.resolve("scripts/default-og.jpg.b64");

if (fs.existsSync(target)) {
  console.log("[prepare-assets] default-og.jpg 已存在，跳过");
  process.exit(0);
}

if (!fs.existsSync(source)) {
  console.error("[prepare-assets] 找不到 scripts/default-og.jpg.b64");
  process.exit(1);
}

const base64 = fs.readFileSync(source, "utf8").replace(/\s/g, "");
fs.writeFileSync(target, Buffer.from(base64, "base64"));
console.log("[prepare-assets] 已从 base64 还原 public/default-og.jpg");
