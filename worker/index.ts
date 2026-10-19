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

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  GITHUB_TOKEN: string;
  ADMIN_PASSWORD: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH?: string;
  POSTS_DIR?: string;
}

const GH_API = "https://api.github.com";

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
  const body = String(payload.body ?? "").replace(/\r\n?/g, "\n");
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (!env.GITHUB_TOKEN || !env.ADMIN_PASSWORD) {
      return json({ error: "服务端未配置 GITHUB_TOKEN / ADMIN_PASSWORD" }, 500);
    }

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

      if (url.pathname === "/api/featured" && request.method === "POST") {
        const payload = (await request.json()) as Record<string, unknown>;
        return await setFeatured(env, payload);
      }

      if (url.pathname === "/api/publish" && request.method === "POST") {
        const payload = (await request.json()) as Record<string, unknown>;
        return await publish(env, payload);
      }

      return json({ error: "Not Found" }, 404);
    } catch (error) {
      return json({ error: `内部错误：${(error as Error).message}` }, 500);
    }
  },
};
