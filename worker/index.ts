/**
 * 文章发布 API —— 挂在 Workers 上，和静态站点同一个部署。
 *
 * 流程：浏览器里的 /admin 页面 → POST /api/publish → GitHub Contents API 提交 markdown
 *      → 仓库变更 → Cloudflare Workers Builds 自动重新构建上线。
 *
 * 需要的密钥（用 wrangler secret put 设置）：
 *   GITHUB_TOKEN    细粒度 PAT，只给目标仓库的 Contents: Read and write 权限
 *   ADMIN_PASSWORD  发文口令，自己定
 *
 * 普通变量（在 wrangler.jsonc 的 vars 里）：
 *   GITHUB_REPO     形如 "li1574/blog"
 *   GITHUB_BRANCH   默认 main
 *   POSTS_DIR       默认 src/content/posts
 */

import { neteaseApi, csrfFrom } from "./netease";

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  GITHUB_TOKEN: string;
  ADMIN_PASSWORD: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH?: string;
  POSTS_DIR?: string;
  IMAGE_BRANCH?: string;
  IMAGE_DIR?: string;
  MUSIC_TAG?: string;
}

const GH_API = "https://api.github.com";
const GH_UPLOAD = "https://uploads.github.com";

/** 允许上传的图片格式，键是扩展名，值是 Content-Type */
const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/** 单张图片上限（前端会先压缩，这里只是兜底） */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** 允许上传的音频格式 */
const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  aiff: "audio/aiff",
  aif: "audio/aiff",
};

/** 单个音频上限 50MB */
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** 定长比较，避免口令被逐字符试探 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(input: string): string {
  const binary = atob(input.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** JSON.stringify 产出的双引号字符串是合法 YAML 标量，顺手解决转义问题 */
const yamlStr = (value: string) => JSON.stringify(value);

/**
 * Markdown 标题必须写成 `## 标题`，`##标题` 不会渲染成标题。
 * 写的人常忘这个空格，发布时自动补上（跳过代码块）。
 */
function normalizeHeadings(text: string): string {
  let inFence = false;
  return text
    .split("\n")
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/^(#{1,6})([^\s#])/, "$1 $2");
    })
    .join("\n");
}

function ghHeaders(env: Env): HeadersInit {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "user-agent": "li1574-blog-publisher",
    "x-github-api-version": "2022-11-28",
  };
}

function postsDir(env: Env): string {
  return env.POSTS_DIR ?? "src/content/posts";
}

function branch(env: Env): string {
  return env.GITHUB_BRANCH ?? "main";
}

function imageBranch(env: Env): string {
  return env.IMAGE_BRANCH ?? "images";
}

function imageDir(env: Env): string {
  return env.IMAGE_DIR ?? "images";
}

/** 图片分支不存在时自动创建（孤立分支，只放图片） */
async function ensureImageBranch(env: Env): Promise<boolean> {
  const head = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/git/ref/heads/${imageBranch(env)}`, {
    headers: ghHeaders(env),
  });
  if (head.ok) return true;

  const call = async (path: string, body: unknown) => {
    const res = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}${path}`, {
      method: "POST",
      headers: { ...ghHeaders(env), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as { sha: string }) : null;
  };

  const blob = await call("/git/blobs", { content: "图片资源分支\n", encoding: "utf-8" });
  if (!blob) return false;
  const tree = await call("/git/trees", {
    tree: [{ path: ".gitkeep", mode: "100644", type: "blob", sha: blob.sha }],
  });
  if (!tree) return false;
  const commit = await call("/git/commits", {
    message: "init: 图片资源分支",
    tree: tree.sha,
    parents: [],
  });
  if (!commit) return false;
  const ref = await call("/git/refs", {
    ref: `refs/heads/${imageBranch(env)}`,
    sha: commit.sha,
  });
  return Boolean(ref);
}

/** 只保留安全字符，中文保留，其余替换成连字符 */
function safeImageName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").normalize("NFC");
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  const clean =
    stem
      .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "img";
  return ext ? `${clean}.${ext}` : clean;
}

function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/** 中文标题没法直接当文件名，兜底用时间戳 */
function normalizeSlug(raw: string, title: string): string {
  const base = (raw || title)
    .trim()
    .toLowerCase()
    .replace(/['"’]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const asciiOnly = base.replace(/[^\p{ASCII}]/gu, "");
  if (asciiOnly.replace(/-/g, "").length >= 2) return base.slice(0, 80);
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `post-${stamp}`;
}

function buildFrontmatter(input: {
  title: string;
  description: string;
  tags: string[];
  draft: boolean;
  date: string;
  author: string;
}): string {
  const tags =
    input.tags.length > 0
      ? `tags:\n${input.tags.map(t => `  - ${yamlStr(t)}`).join("\n")}`
      : `tags:\n  - ${yamlStr("随笔")}`;
  return [
    "---",
    `title: ${yamlStr(input.title)}`,
    `description: ${yamlStr(input.description)}`,
    `pubDatetime: ${input.date}`,
    `author: ${yamlStr(input.author)}`,
    tags,
    `draft: ${input.draft}`,
    "---",
    "",
  ].join("\n");
}

/** 从 markdown 原文里抠出需要的元信息 */
function parseMeta(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = match ? match[1] : "";
  const get = (key: string) => {
    const hit = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(fm);
    return hit ? hit[1].replace(/^["']|["']$/g, "").trim() : "";
  };
  return {
    title: get("title"),
    featured: get("featured") === "true",
    draft: get("draft") === "true",
    pubDatetime: get("pubDatetime"),
  };
}

/** 改写 frontmatter 里的某个布尔字段，其余内容原样保留 */
function setFlag(content: string, key: string, value: boolean): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("这篇文章没有 frontmatter，无法修改");

  let fm = match[1].replace(/\r\n/g, "\n");
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:.*$`, "m");

  if (re.test(fm)) fm = fm.replace(re, line);
  else fm = `${fm}\n${line}`;

  const rest = content.slice(match[0].length).replace(/^\r?\n/, "");
  return `---\n${fm}\n---\n${rest}`;
}

async function listPosts(env: Env): Promise<Response> {
  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/contents/${postsDir(env)}?ref=${branch(env)}`,
    { headers: ghHeaders(env) }
  );
  if (res.status === 404) return json({ posts: [] });
  if (!res.ok) return json({ error: `GitHub ${res.status}: ${await res.text()}` }, 502);

  const items = (await res.json()) as Array<{
    name: string;
    path: string;
    sha: string;
    type: string;
  }>;

  const files = items
    .filter(item => item.type === "file" && /\.mdx?$/.test(item.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 逐篇读取，拿到标题和精选状态。文章不多时开销可接受。
  const posts = await Promise.all(
    files.map(async item => {
      let meta = { title: "", featured: false, draft: false, pubDatetime: "" };
      try {
        const one = await fetch(
          `${GH_API}/repos/${env.GITHUB_REPO}/contents/${item.path}?ref=${branch(env)}`,
          { headers: ghHeaders(env) }
        );
        if (one.ok) {
          const file = (await one.json()) as { content: string };
          meta = parseMeta(fromBase64(file.content));
        }
      } catch {
        // 单篇读取失败不影响列表
      }
      return { name: item.name, path: item.path, sha: item.sha, ...meta };
    })
  );

  return json({ posts });
}

/** 切换某篇文章的精选状态 */
async function setFeatured(env: Env, payload: Record<string, unknown>): Promise<Response> {
  const path = String(payload.path ?? "");
  const featured = Boolean(payload.featured);
  if (!path || path.includes("..")) return json({ error: "参数不合法" }, 400);

  const head = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/contents/${path}?ref=${branch(env)}`,
    { headers: ghHeaders(env) }
  );
  if (!head.ok) return json({ error: `读取失败：GitHub ${head.status}` }, 502);

  const file = (await head.json()) as { content: string; sha: string };
  const original = fromBase64(file.content);
  const updated = setFlag(original, "featured", featured);

  const res = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(env), "content-type": "application/json" },
    body: JSON.stringify({
      message: `${featured ? "设为精选" : "取消精选"}：${parseMeta(original).title || path}`,
      content: toBase64(updated),
      branch: branch(env),
      sha: file.sha,
    }),
  });

  if (!res.ok) return json({ error: `提交失败：GitHub ${res.status} ${await res.text()}` }, 502);

  const result = (await res.json()) as { commit: { html_url: string } };
  return json({
    ok: true,
    featured,
    commit: result.commit.html_url,
    note: "已提交，1-2 分钟后线上生效。",
  });
}

async function readPost(env: Env, path: string): Promise<Response> {
  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/contents/${path}?ref=${branch(env)}`,
    { headers: ghHeaders(env) }
  );
  if (!res.ok) return json({ error: `读取失败：GitHub ${res.status}` }, res.status);
  const file = (await res.json()) as { content: string; sha: string };
  return json({ content: fromBase64(file.content), sha: file.sha });
}

async function publish(env: Env, payload: Record<string, unknown>): Promise<Response> {
  const title = String(payload.title ?? "").trim();
  const description = String(payload.description ?? "").trim();
  // 浏览器/剪贴板可能带 CRLF，统一成 LF，避免仓库里出现混合换行
  const body = normalizeHeadings(String(payload.body ?? "").replace(/\r\n?/g, "\n"));
  if (!title) return json({ error: "标题不能为空" }, 400);
  if (!description) return json({ error: "摘要不能为空（SEO 会用到）" }, 400);
  if (!body.trim()) return json({ error: "正文不能为空" }, 400);

  const tags = Array.isArray(payload.tags)
    ? payload.tags.map(tag => String(tag).trim()).filter(Boolean)
    : [];
  const draft = Boolean(payload.draft);
  const author = String(payload.author ?? "li1574");
  const date = String(payload.date ?? new Date().toISOString());

  const slug = normalizeSlug(String(payload.slug ?? ""), title);
  const path = `${postsDir(env)}/${slug}.md`;

  const content =
    buildFrontmatter({ title, description, tags, draft, date, author }) + body.replace(/^\n+/, "");

  // 先查是否已存在，决定是新建还是更新
  const head = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/contents/${path}?ref=${branch(env)}`,
    { headers: ghHeaders(env) }
  );
  let sha: string | undefined;
  if (head.ok) {
    const existing = (await head.json()) as { sha: string };
    sha = existing.sha;
  }

  const res = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(env), "content-type": "application/json" },
    body: JSON.stringify({
      message: `${sha ? "更新" : "新增"}文章：${title}`,
      content: toBase64(content),
      branch: branch(env),
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) {
    return json({ error: `提交失败：GitHub ${res.status} ${await res.text()}` }, 502);
  }

  const result = (await res.json()) as { commit: { html_url: string } };
  return json({
    ok: true,
    updated: Boolean(sha),
    path,
    url: `https://blog.li1574.ccwu.cc/posts/${slug}`,
    commit: result.commit.html_url,
    note: "已提交到仓库，Cloudflare 会在 1-2 分钟内重新构建上线。",
  });
}

/** 公开：图片列表 */
async function listPhotos(env: Env): Promise<Response> {
  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/contents/${imageDir(env)}?ref=${imageBranch(env)}`,
    { headers: ghHeaders(env) }
  );
  if (res.status === 404) return json({ photos: [] });
  if (!res.ok) return json({ error: `GitHub ${res.status}` }, 502);

  const items = (await res.json()) as Array<{
    name: string;
    size: number;
    sha: string;
    type: string;
  }>;

  const photos = items
    .filter(item => item.type === "file" && IMAGE_TYPES[extOf(item.name)])
    .map(item => ({
      name: item.name,
      size: item.size,
      url: `/img/${encodeURIComponent(item.name)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  return json({ photos });
}

/** 公开：从 GitHub 取图，缓存到边缘节点 */
async function serveImage(env: Env, rawName: string): Promise<Response> {
  let clean: string;
  try {
    clean = decodeURIComponent(rawName);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!clean || clean.includes("..") || clean.includes("/")) {
    return new Response("Not found", { status: 404 });
  }

  const type = IMAGE_TYPES[extOf(clean)];
  if (!type) return new Response("Unsupported", { status: 415 });

  // caches.default 是 Cloudflare 的扩展，标准 DOM 类型里没有
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`https://img.cache/${encodeURIComponent(clean)}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/contents/${imageDir(env)}/${encodeURIComponent(clean)}?ref=${imageBranch(env)}`,
    { headers: { ...ghHeaders(env), accept: "application/vnd.github.raw" } }
  );
  if (!res.ok) return new Response("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "content-type": type,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  // SVG 直接访问时可能执行脚本，加一条 CSP 兜底
  if (type === "image/svg+xml") {
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  }

  const out = new Response(await res.arrayBuffer(), { headers });
  await cache.put(key, out.clone());
  return out;
}

/** 上传图片到图片分支 */
async function uploadPhoto(env: Env, payload: Record<string, unknown>): Promise<Response> {
  const rawName = String(payload.name ?? "").trim();
  const data = String(payload.data ?? "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!rawName || !data) return json({ error: "缺少文件名或图片内容" }, 400);

  const name = safeImageName(rawName);
  const ext = extOf(name);
  if (!IMAGE_TYPES[ext]) {
    return json(
      { error: `不支持的格式：${ext || "未知"}（支持 ${Object.keys(IMAGE_TYPES).join(" / ")}）` },
      415
    );
  }

  const bytes = Math.floor((data.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    return json({ error: `图片 ${(bytes / 1048576).toFixed(1)}MB，超过 12MB 上限` }, 413);
  }

  if (!(await ensureImageBranch(env))) {
    return json({ error: "图片分支创建失败，请检查令牌权限" }, 500);
  }

  // 重名就加序号，不覆盖已有图片
  const stem = name.slice(0, name.length - ext.length - 1);
  let finalName = name;
  for (let i = 2; i < 50; i++) {
    const probe = await fetch(
      `${GH_API}/repos/${env.GITHUB_REPO}/contents/${imageDir(env)}/${encodeURIComponent(finalName)}?ref=${imageBranch(env)}`,
      { headers: ghHeaders(env) }
    );
    if (probe.status === 404) break;
    finalName = `${stem}-${i}.${ext}`;
  }

  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/contents/${imageDir(env)}/${encodeURIComponent(finalName)}`,
    {
      method: "PUT",
      headers: { ...ghHeaders(env), "content-type": "application/json" },
      body: JSON.stringify({
        message: `上传图片：${finalName}`,
        content: data,
        branch: imageBranch(env),
      }),
    }
  );

  if (!res.ok) {
    return json({ error: `上传失败：GitHub ${res.status} ${await res.text()}` }, 502);
  }

  const result = (await res.json()) as { commit: { html_url: string } };
  const url = `/img/${encodeURIComponent(finalName)}`;
  return json({
    ok: true,
    name: finalName,
    url,
    markdown: `![${finalName}](${url})`,
    commit: result.commit.html_url,
  });
}

/** 删除图片 */
async function deletePhoto(env: Env, rawName: string): Promise<Response> {
  const clean = decodeURIComponent(rawName);
  if (!clean || clean.includes("..") || clean.includes("/")) {
    return json({ error: "参数不合法" }, 400);
  }

  const path = `${imageDir(env)}/${encodeURIComponent(clean)}`;
  const head = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/contents/${path}?ref=${imageBranch(env)}`,
    { headers: ghHeaders(env) }
  );
  if (!head.ok) return json({ error: `图片不存在（GitHub ${head.status}）` }, 404);

  const file = (await head.json()) as { sha: string };
  const res = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: "DELETE",
    headers: { ...ghHeaders(env), "content-type": "application/json" },
    body: JSON.stringify({
      message: `删除图片：${clean}`,
      sha: file.sha,
      branch: imageBranch(env),
    }),
  });

  if (!res.ok) return json({ error: `删除失败：GitHub ${res.status}` }, 502);
  return json({ ok: true, note: "已删除。已缓存的图片会在边缘缓存过期后消失。" });
}

/** 删除文章 */
async function deletePost(env: Env, path: string): Promise<Response> {
  if (!path || path.includes("..") || !path.startsWith(postsDir(env))) {
    return json({ error: "参数不合法" }, 400);
  }

  const head = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/contents/${path}?ref=${branch(env)}`,
    { headers: ghHeaders(env) }
  );
  if (!head.ok) return json({ error: `文章不存在（GitHub ${head.status}）` }, 404);

  const file = (await head.json()) as { sha: string; content: string };
  const title = parseMeta(fromBase64(file.content)).title || path;

  const res = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: "DELETE",
    headers: { ...ghHeaders(env), "content-type": "application/json" },
    body: JSON.stringify({
      message: `删除文章：${title}`,
      sha: file.sha,
      branch: branch(env),
    }),
  });

  if (!res.ok) return json({ error: `删除失败：GitHub ${res.status} ${await res.text()}` }, 502);
  return json({ ok: true, title, note: "已提交删除，1-2 分钟后线上消失。" });
}

/* ============================================================
 * 音乐库
 *
 * 音频不走 Contents API：50MB 的文件 base64 编码后是 67MB，
 * Worker 的 128MB 内存装不下两份。改用 GitHub Releases：
 * 上传是原始二进制流式转发（内存恒定），播放走 Release 资产，
 * GitHub 的 CDN 支持 Range，拖动进度条没问题。
 * ============================================================ */

function musicTag(env: Env): string {
  return env.MUSIC_TAG ?? "music";
}

/** 文件名去掉扩展名，就是曲名 */
function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Release 资产名只接受 ASCII：中文会被 GitHub 直接丢掉，
 * 结果变成 default.wav，第二次上传还会撞名报 already_exists。
 * 所以资产名转成 ASCII，原始曲名放进 label 字段。
 */
function asciiAssetName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const clean =
    stem
      .replace(/[^\x20-\x7E]/g, "-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 50) || `track-${Date.now().toString(36)}`;
  return ext ? `${clean}.${ext}` : clean;
}

type ReleaseAsset = { id: number; name: string; size: number; label?: string | null };

async function listAssets(env: Env, releaseId: number): Promise<ReleaseAsset[]> {
  const res = await fetch(
    `${GH_API}/repos/${env.GITHUB_REPO}/releases/${releaseId}/assets?per_page=100`,
    { headers: ghHeaders(env) }
  );
  if (!res.ok) return [];
  return (await res.json()) as ReleaseAsset[];
}

/** 拿到（必要时创建）音乐库 Release */
async function musicRelease(env: Env): Promise<{ id: number } | null> {
  const tag = musicTag(env);
  const res = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/releases/tags/${tag}`, {
    headers: ghHeaders(env),
  });
  if (res.ok) return (await res.json()) as { id: number };
  if (res.status !== 404) return null;

  const created = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/releases`, {
    method: "POST",
    headers: { ...ghHeaders(env), "content-type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: "音乐库",
      body: "本站音乐播放器的音频文件，由后台上传维护。",
      target_commitish: branch(env),
    }),
  });
  if (!created.ok) return null;
  return (await created.json()) as { id: number };
}

/** 公开：曲目列表 */
async function listTracks(env: Env): Promise<Response> {
  const rel = await musicRelease(env);
  if (!rel) return json({ error: "音乐库不可用" }, 502);

  const assets = await listAssets(env, rel.id);
  const tracks = assets
    .filter(asset => AUDIO_TYPES[extOf(asset.name)])
    .map(asset => ({
      name: asset.name,
      title: (asset.label && asset.label.trim()) || stemOf(asset.name),
      size: asset.size,
      url: `/audio/${encodeURIComponent(asset.name)}`,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

  return json({ tracks });
}

/** 上传：原始二进制流式转发给 GitHub，不经过 base64 */
async function uploadTrack(env: Env, request: Request): Promise<Response> {
  const rawName = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  if (!rawName) return json({ error: "缺少文件名" }, 400);

  const name = safeImageName(rawName);
  const ext = extOf(name);
  const type = AUDIO_TYPES[ext];
  if (!type) {
    return json(
      { error: `不支持的音频格式：${ext || "未知"}（支持 ${Object.keys(AUDIO_TYPES).join(" / ")}）` },
      415
    );
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (!length) return json({ error: "缺少 Content-Length，无法确认文件大小" }, 411);
  if (length > MAX_AUDIO_BYTES) {
    return json({ error: `音频 ${(length / 1048576).toFixed(1)}MB，超过 50MB 上限` }, 413);
  }
  if (!request.body) return json({ error: "请求没有内容" }, 400);

  const rel = await musicRelease(env);
  if (!rel) return json({ error: "音乐库创建失败，请检查令牌权限" }, 500);

  // 资产名只能是 ASCII，中文原名进 label
  const title = stemOf(name);
  const base = asciiAssetName(name);
  const baseStem = stemOf(base);

  const assets = await listAssets(env, rel.id);
  let assetName = base;
  for (let i = 2; i < 100 && assets.some(a => a.name === assetName); i++) {
    assetName = `${baseStem}-${i}.${ext}`;
  }

  const res = await fetch(
    `${GH_UPLOAD}/repos/${env.GITHUB_REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(assetName)}&label=${encodeURIComponent(title)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "content-type": type,
        "content-length": String(length),
        "user-agent": "li1574-blog-publisher",
        accept: "application/vnd.github+json",
      },
      body: request.body,
      // Node/undici 需要这个字段，Workers 运行时忽略
      duplex: "half",
    } as RequestInit
  );

  if (!res.ok) {
    return json({ error: `上传失败：GitHub ${res.status} ${await res.text()}` }, 502);
  }

  const asset = (await res.json()) as { name: string; size: number };
  return json({
    ok: true,
    name: asset.name,
    title,
    size: asset.size,
  });
}

/** 删除曲目 */
async function deleteTrack(env: Env, rawName: string): Promise<Response> {
  const clean = decodeURIComponent(rawName);
  if (!clean || clean.includes("..")) return json({ error: "参数不合法" }, 400);

  const rel = await musicRelease(env);
  if (!rel) return json({ error: "音乐库不可用" }, 502);

  const asset = (await listAssets(env, rel.id)).find(a => a.name === clean);
  if (!asset) return json({ error: "曲目不存在" }, 404);

  const res = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/releases/assets/${asset.id}`, {
    method: "DELETE",
    headers: ghHeaders(env),
  });
  if (!res.ok) return json({ error: `删除失败：GitHub ${res.status}` }, 502);
  return json({ ok: true, note: "已删除。" });
}

/**
 * 公开：音频代理。
 * 直接转发到 Release 资产地址，并把 Range 头原样带上，
 * 这样浏览器可以拖动进度条（206 Partial Content）。
 */
async function serveAudio(env: Env, rawName: string, request: Request): Promise<Response> {
  let clean: string;
  try {
    clean = decodeURIComponent(rawName);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!clean || clean.includes("..") || clean.includes("/")) {
    return new Response("Not found", { status: 404 });
  }

  const type = AUDIO_TYPES[extOf(clean)];
  if (!type) return new Response("Unsupported", { status: 415 });

  const source = `https://github.com/${env.GITHUB_REPO}/releases/download/${musicTag(env)}/${encodeURIComponent(clean)}`;
  const range = request.headers.get("range");

  const upstream = await fetch(source, {
    headers: range ? { range } : {},
    redirect: "follow",
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Not found", { status: upstream.status === 404 ? 404 : 502 });
  }

  const headers = new Headers();
  headers.set("content-type", type);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=604800");
  for (const key of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

/* ============================================================
 * 网易云音乐
 *
 * 登录态不落服务端：cookie 由浏览器保存，每次请求通过
 * x-netease-cookie 头带上来，Worker 只做加密转发。
 * ============================================================ */

type NeteaseSong = {
  id: number;
  name: string;
  artists: string;
  album: string;
  duration: number;
  cover: string;
};

function mapSongs(data: Record<string, unknown>): NeteaseSong[] {
  const source = data as {
    result?: { songs?: unknown[] };
    songs?: unknown[];
    data?: { dailySongs?: unknown[] };
  };
  const list = (source.result?.songs ?? source.songs ?? source.data?.dailySongs ?? []) as Array<
    Record<string, unknown>
  >;

  return list.map(song => {
    const artists = (song.artists ?? song.ar ?? []) as Array<{ name?: string }>;
    const album = (song.album ?? song.al ?? {}) as { name?: string; picUrl?: string };
    return {
      id: Number(song.id),
      name: String(song.name ?? ""),
      artists: artists.map(a => a.name ?? "").filter(Boolean).join(" / "),
      album: album.name ?? "",
      duration: Number(song.duration ?? song.dt ?? 0),
      cover: album.picUrl ?? "",
    };
  });
}

/** 从 set-cookie 里挑出需要的几个字段拼成 cookie 串 */
function cookieFromSetCookie(header: string | null): string {
  if (!header) return "";
  const wanted = ["MUSIC_U", "__csrf", "MUSIC_A", "NMTID", "__remember_me"];
  const parts: string[] = [];
  for (const chunk of header.split(/,(?=[^;]+=)/)) {
    const pair = chunk.split(";")[0].trim();
    const name = pair.split("=")[0];
    if (wanted.includes(name)) parts.push(pair);
  }
  return parts.join("; ");
}

async function handleNetease(url: URL, request: Request): Promise<Response> {
  const cookie = request.headers.get("x-netease-cookie") ?? "";
  const csrf = csrfFrom(cookie);
  const route = url.pathname.replace("/api/netease/", "");

  try {
    if (route === "search") {
      const kw = (url.searchParams.get("kw") ?? "").trim();
      if (!kw) return json({ songs: [] });
      const { data } = await neteaseApi("/weapi/search/get", { s: kw, type: 1, limit: 30, offset: 0 }, cookie);
      return json({ songs: mapSongs(data) });
    }

    if (route === "recommend") {
      const { data } = await neteaseApi(
        "/api/v3/discovery/recommend/songs",
        { csrf_token: csrf },
        cookie
      );
      return json({ songs: mapSongs(data) });
    }

    if (route === "playlists") {
      const uid = url.searchParams.get("uid");
      if (!uid) return json({ error: "缺少 uid" }, 400);
      const { data } = await neteaseApi(
        "/weapi/user/playlist",
        { uid, limit: 1000, offset: 0, csrf_token: csrf },
        cookie
      );
      const list = ((data as { playlist?: unknown[] }).playlist ?? []) as Array<Record<string, unknown>>;
      return json({
        playlists: list.map(p => ({
          id: Number(p.id),
          name: String(p.name ?? ""),
          cover: String(p.coverImgUrl ?? ""),
          count: Number(p.trackCount ?? 0),
          creator: Boolean(p.subscribed) ? "收藏" : "创建",
        })),
      });
    }

    if (route === "playlist") {
      const id = Number(url.searchParams.get("id") ?? 0);
      if (!id) return json({ error: "缺少 id" }, 400);
      const { data } = await neteaseApi(
        "/weapi/v6/playlist/detail",
        { id, n: 1000, s: 0, csrf_token: csrf },
        cookie
      );
      const playlist = (data as { playlist?: Record<string, unknown> }).playlist;
      if (!playlist) return json({ error: "歌单不存在" }, 404);
      return json({
        name: String(playlist.name ?? ""),
        cover: String(playlist.coverImgUrl ?? ""),
        songs: mapSongs({ songs: playlist.tracks as unknown[] }),
      });
    }

    if (route === "url") {
      const id = Number(url.searchParams.get("id") ?? 0);
      if (!id) return json({ error: "缺少 id" }, 400);
      const { data } = await neteaseApi(
        "/weapi/song/enhance/player/url",
        { ids: `[${id}]`, br: 320000 },
        cookie
      );
      const first = ((data as { data?: Array<Record<string, unknown>> }).data ?? [])[0];
      return json({ url: (first?.url as string) ?? null, br: Number(first?.br ?? 0) });
    }

    if (route === "account") {
      const { data } = await neteaseApi("/weapi/w/nuser/account/get", { csrf_token: csrf }, cookie);
      const profile = (data as { profile?: Record<string, unknown> }).profile;
      return json({
        profile: profile
          ? { uid: Number(profile.userId), nickname: String(profile.nickname ?? ""), avatar: String(profile.avatarUrl ?? "") }
          : null,
      });
    }

    if (route === "login" && request.method === "POST") {
      const body = (await request.json()) as {
        phone?: string;
        password?: string;
        countrycode?: string;
      };
      if (!body.phone || !body.password) return json({ error: "手机号和密码都要填" }, 400);

      const { data, setCookie } = await neteaseApi("/weapi/login/cellphone", {
        phone: body.phone,
        password: body.password,
        countrycode: body.countrycode ?? "86",
        rememberLogin: true,
      });

      const code = Number((data as { code?: number }).code ?? 0);
      if (code !== 200) {
        return json(
          { error: String((data as { msg?: string; message?: string }).msg ?? (data as { message?: string }).message ?? `登录失败（${code}）`) },
          401
        );
      }

      const cookie = cookieFromSetCookie(setCookie);
      const profile = (data as { profile?: Record<string, unknown> }).profile;
      return json({
        cookie,
        profile: profile
          ? { uid: Number(profile.userId), nickname: String(profile.nickname ?? ""), avatar: String(profile.avatarUrl ?? "") }
          : null,
      });
    }

    return json({ error: "Not Found" }, 404);
  } catch (error) {
    return json({ error: `网易接口出错：${(error as Error).message}` }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 音频代理：公开可读，转发 Range 支持拖动进度条
    if (url.pathname.startsWith("/audio/")) {
      if (!env.GITHUB_TOKEN) return new Response("服务端未配置", { status: 500 });
      return await serveAudio(env, url.pathname.slice("/audio/".length), request);
    }

    // 图片代理：公开可读，带边缘缓存
    if (url.pathname.startsWith("/img/")) {
      if (!env.GITHUB_TOKEN) return new Response("服务端未配置", { status: 500 });
      return await serveImage(env, url.pathname.slice("/img/".length));
    }

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (!env.GITHUB_TOKEN || !env.ADMIN_PASSWORD) {
      return json({ error: "服务端未配置 GITHUB_TOKEN / ADMIN_PASSWORD" }, 500);
    }

    // 公开只读接口，图片浏览页和音乐播放器要用
    if (url.pathname === "/api/photos" && request.method === "GET") {
      try {
        return await listPhotos(env);
      } catch (error) {
        return json({ error: `内部错误：${(error as Error).message}` }, 500);
      }
    }

    if (url.pathname === "/api/music" && request.method === "GET") {
      try {
        return await listTracks(env);
      } catch (error) {
        return json({ error: `内部错误：${(error as Error).message}` }, 500);
      }
    }

    // 网易云音乐接口（公开，登录态由浏览器通过 header 带上）
    if (url.pathname.startsWith("/api/netease/")) {
      return await handleNetease(url, request);
    }

    // 以下都要口令
    const password = request.headers.get("x-admin-password") ?? "";
    if (!safeEqual(password, env.ADMIN_PASSWORD)) {
      return json({ error: "口令不正确" }, 401);
    }

    try {
      if (url.pathname === "/api/posts" && request.method === "GET") {
        return await listPosts(env);
      }

      if (url.pathname === "/api/post" && request.method === "GET") {
        const path = url.searchParams.get("path");
        if (!path || path.includes("..")) return json({ error: "参数不合法" }, 400);
        return await readPost(env, path);
      }

      if (url.pathname === "/api/post" && request.method === "DELETE") {
        const path = url.searchParams.get("path");
        if (!path) return json({ error: "缺少 path 参数" }, 400);
        return await deletePost(env, path);
      }

      if (url.pathname === "/api/featured" && request.method === "POST") {
        const payload = (await request.json()) as Record<string, unknown>;
        return await setFeatured(env, payload);
      }

      if (url.pathname === "/api/publish" && request.method === "POST") {
        const payload = (await request.json()) as Record<string, unknown>;
        return await publish(env, payload);
      }

      if (url.pathname === "/api/upload" && request.method === "POST") {
        const payload = (await request.json()) as Record<string, unknown>;
        return await uploadPhoto(env, payload);
      }

      if (url.pathname === "/api/photo" && request.method === "DELETE") {
        const name = url.searchParams.get("name");
        if (!name) return json({ error: "缺少 name 参数" }, 400);
        return await deletePhoto(env, name);
      }

      if (url.pathname === "/api/music" && request.method === "POST") {
        return await uploadTrack(env, request);
      }

      if (url.pathname === "/api/music" && request.method === "DELETE") {
        const name = url.searchParams.get("name");
        if (!name) return json({ error: "缺少 name 参数" }, 400);
        return await deleteTrack(env, name);
      }

      return json({ error: "Not Found" }, 404);
    } catch (error) {
      return json({ error: `内部错误：${(error as Error).message}` }, 500);
    }
  },
};
