# AstroPaper v6 使用教程

> 基于 `satnaing/astro-paper` 实际源码核对（v6.1.0，Astro 7.0.3，Tailwind 4.3），非二手资料。
> 本地已完整跑通 `install → build → dev`。

---

## 0. 它是什么，适合谁

一个极简、响应式、SEO 友好、无障碍达标的 Astro 博客主题。5.1k star，MIT 协议，作者 Sat Naing。

核心特性：

- 纯静态输出（默认，无 SSR），可直接扔到任意静态托管
- TypeScript 强类型 frontmatter，写错字段构建就报错
- 自带 Pagefind 全文搜索（无需后端）
- 亮/暗色模式、归档页、标签页、RSS、sitemap
- 构建时用 Satori + Sharp 动态生成每篇文章的 OG 图
- MDX、代码高亮、Callout 提示块、可折叠目录

**适合**：技术博客、个人随笔、文档站。
**不适合**：需要评论/会员/后台编辑的站（评论可以外挂 Giscus，后台没有）。

---

## 1. 环境要求

| 项 | 要求 |
|---|---|
| Node | **≥ 22.12.0**（`package.json` 的 engines 硬约束） |
| 包管理器 | pnpm / npm / yarn / bun 都行，仓库自带 `pnpm-lock.yaml`，用 pnpm 最省事 |

先验证：

```bash
node -v    # 必须 >= v22.12.0
```

> [!WARNING]
> Node 版本不够时 `astro check` 会直接失败，报语法错误而不是版本错误，很难查。先升级 Node。

---

## 2. 拿到项目（三种方式，选一）

### 方式 A：官方脚手架（推荐）

```bash
npm create astro@latest -- --template satnaing/astro-paper
```

会交互式问你项目名、是否装依赖、是否初始化 git。全程选默认即可。

### 方式 B：git clone（想保留上游历史、方便 `git pull` 跟进更新）

```bash
git clone --depth 1 https://github.com/satnaing/astro-paper.git my-blog
cd my-blog
rm -rf .git          # 换成自己的仓库，不要保留上游历史
npm install
```

### 方式 C：GitHub 网页「Use this template」

仓库页右上角 **Use this template → Create a new repository**，得到一个干净的新仓库，然后本地 clone 下来 `npm install`。

> [!TIP]
> 只想快速看效果、不想污染自己的仓库，用方式 B。想长期维护并跟进主题更新，用方式 C（保留 upstream 关系后可以 `git remote add upstream` 拉更新）。

### 下载失败排查（中国大陆常见）

`git clone` 报 `CRYPT_E_REVOCATION_OFFLINE` 或 `SSL certificate problem`，是 Windows schannel 后端做证书吊销检查时连不上 CA 服务器。三个解法，从轻到重：

```bash
# 1. 只对这一次命令关掉吊销检查
git -c http.schannelCheckRevoke=false clone https://github.com/satnaing/astro-paper.git

# 2. 换 OpenSSL 后端（实测这条能过）
git -c http.sslBackend=openssl clone --depth 1 https://github.com/satnaing/astro-paper.git

# 3. 全局配置（一次解决，之后所有仓库生效）
git config --global http.sslBackend openssl
```

如果 `github.com` 整个不通但 `registry.npmjs.org` 通，用方式 A 也大概率失败（脚手架要下载 GitHub tarball）。此时走镜像：

```bash
# 用 npm 镜像装依赖，模板包从镜像拉
npm config set registry https://registry.npmmirror.com
```

---

## 3. 目录结构

```
├── astro-paper.config.ts   ← 你的配置，只改这一个文件
├── astro.config.ts         ← Astro 本体配置（主题/插件/i18n），一般不动
├── public/                 ← 不处理的静态资源，原样复制
│   ├── favicon.svg
│   └── default-og.jpg
└── src/
    ├── assets/
    │   ├── icons/socials/  ← 社交图标 SVG，文件名即 socials.name
    │   └── images/         ← 文章配图（会被优化）
    ├── components/
    ├── content/
    │   ├── pages/about.md  ← 关于页内容
    │   └── posts/          ← 所有文章在这
    ├── i18n/lang/          ← 语言包，目前只有 en.ts
    ├── layouts/            ← Layout.astro / PostLayout.astro
    ├── pages/              ← 路由：index / posts / tags / archives / search / rss.xml / robots.txt / 404
    ├── styles/
    │   ├── theme.css       ← 配色变量在这改
    │   └── global.css
    ├── config.ts           ← 内部解析层，不要改
    └── content.config.ts   ← frontmatter 的 zod schema
```

**关键认知**：v6 把用户配置从 `src/config.ts` 挪到了根目录的 `astro-paper.config.ts`。网上大部分老教程让你改 `src/config.ts`，那个文件现在写着"别改我"，改了会被默认值覆盖。

---

## 4. 必改配置：`astro-paper.config.ts`

打开这个文件，逐项替换：

```ts
import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://your-domain.com/",   // 必改！影响 canonical / RSS / sitemap
    title: "你的站点名",
    description: "一句话简介，进 SEO meta 和 RSS",
    author: "你的名字",
    profile: "https://github.com/yourname",  // 结构化数据里的作者链接
    ogImage: "default-og.jpg",         // public/ 下的文件名
    lang: "zh-CN",                     // 中文站改成这个
    timezone: "Asia/Shanghai",         // IANA 时区，决定文章日期怎么算
    dir: "ltr",
  },
  posts: {
    perPage: 4,        // 分页每页篇数
    perIndex: 4,       // 首页显示篇数
    scheduledPostMargin: 15 * 60 * 1000,  // 定时发布容差
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,   // 构建时自动生成 OG 图（用 satori + sharp）
    showArchives: true,     // 归档页
    showBackButton: true,
    editPost: {
      enabled: true,
      url: "https://github.com/你的用户名/你的仓库/edit/main/",  // 必改
    },
    search: "pagefind",     // 或 false 关掉搜索
  },
  socials: [
    { name: "github", url: "https://github.com/yourname" },
    { name: "mail",   url: "mailto:you@example.com" },
    // name 必须对应 src/assets/icons/socials/{name}.svg
  ],
  shareLinks: [ /* 分享按钮，同上，可整段删掉 */ ],
});
```

### socials 的坑

`name` 不是随便写的，它必须匹配 `src/assets/icons/socials/` 下的文件名。当前只有 8 个：

```
facebook  github  linkedin  mail  pinterest  telegram  whatsapp  x
```

想加微博、B站、知乎、小红书？自己画一个 SVG 丢进那个目录，文件名就是 `name`。图标会被当 Astro 组件导入，不是 `<img>`。

### `site.url` 为什么必须改

它同时喂给 `astro.config.ts` 的 `site` 字段，决定：

- `<link rel="canonical">`
- `sitemap-index.xml` 里的绝对地址
- RSS 里每篇文章的链接
- 动态 OG 图的绝对路径

写成默认的 `astro-paper.pages.dev` 会导致搜索引擎收录指向别人的站。

---

## 5. 写第一篇文章

在 `src/content/posts/` 下新建 `.md` 或 `.mdx` 文件。**文件名就是 URL**。

### 路径 → URL 规则

| 文件路径 | 生成的 URL |
|---|---|
| `posts/hello-world.md` | `/posts/hello-world` |
| `posts/2025/hello.md` | `/posts/2025/hello` |
| `posts/_2026/hello.md` | `/posts/hello` ← 下划线目录不进 URL |
| `posts/docs/_legacy/how.md` | `/posts/docs/how` |
| `posts/My First Post.md` | `/posts/my-first-post` ← 自动 kebab-case |

> [!TIP]
> 用 `_` 前缀的目录做草稿区或素材区，不会被路由。文件名也别用中文，会被 slugify 转成一串拼音或乱码。

### frontmatter 完整字段

只有 `title`、`description`、`pubDatetime` 是必填，其余都有默认值。

```yaml
---
title: 我的第一篇文章
description: 一段 100 字以内的摘要，会显示在列表页和 SEO meta 里。
pubDatetime: 2026-10-18T09:00:00+08:00
modDatetime: 2026-10-20T10:00:00+08:00   # 只在改过文章时加
author: 你的名字                            # 默认取 site.author
featured: true                             # 上首页推荐位
draft: false                               # true = 不发布
tags:
  - 随笔
  - Astro
ogImage: ../../assets/images/cover.png     # 相对路径，或直接写 https:// 远程图
canonicalURL: https://example.com/original # 原文已发在别处时用
hideEditPost: true                         # 单篇隐藏"编辑此页"按钮
timezone: Asia/Shanghai                    # 覆盖全局时区
---
```

字段约束来自 `src/content.config.ts`，写错类型构建直接失败——这是它的优点。

> [!WARNING]
> 网上教程里的 `slug:` 字段在 v6 已经失效。schema 里没有这个字段，URL 完全由文件路径决定。写上去不会报错，但也不生效，别浪费时间排查。

### 正文规范

- frontmatter 的 `title` 已经是 `<h1>`，正文**从 `##` 开始**，不要再写 `#`
- 需要目录？在正文想要的位置写一行 `## Table of contents`，构建时会自动替换成可折叠的 TOC
- 支持 MDX：文件后缀改 `.mdx` 即可写组件

### 内置的 Callout 提示块

```md
> [!NOTE]
> 补充说明。

> [!TIP]
> 实用技巧。

> [!WARNING]
> 可能出问题的地方。

> [!DANGER]
> 数据丢失级别的风险。

> [!TIP]- 默认折叠
> 加 `-` 折叠，加 `+` 默认展开但可折叠。

> [!NOTE] 自定义标题
> 类型后面的文字会替换默认标题。
```

支持类型：`NOTE` `ABSTRACT` `INFO` `TODO` `TIP` `SUCCESS` `QUESTION` `WARNING` `FAILURE` `DANGER` `BUG` `EXAMPLE` `QUOTE`，样式来自 Obsidian 主题。

### 代码块增强

```md
```ts file="src/config.ts"
const a = 1; // [!code highlight]
const b = 2; // [!code ++]
const c = 3; // [!code --]
```
```

`file="..."` 显示文件名，`[!code highlight]` 高亮整行，`++`/`--` 显示 diff。底层是 Shiki，亮色主题 `min-light`、暗色 `night-owl`。

### 图片放哪

| 位置 | 引用方式 | 是否优化 |
|---|---|---|
| `src/assets/images/` | `![alt](@/assets/images/x.jpg)` 或相对路径 | ✅ 自动压缩、转格式 |
| `public/` | `![alt](/images/x.jpg)` 绝对路径 | ❌ 原样输出 |

> [!IMPORTANT]
> Markdown 里用 `<img src="@/assets/...">` 是**无效**的，别名只在 markdown 图片语法和 MDX 组件里生效。要自定义样式就用 MDX + `<Image>` 组件。

---

## 6. 本地开发

```bash
npm run dev        # http://localhost:4321
npm run build      # 类型检查 + 构建 + Pagefind 索引
npm run preview    # 本地预览构建产物
```

> [!WARNING]
> **`npm run dev` 里搜索框是搜不出东西的**，这是正常的。Pagefind 索引只在 `build` 时生成，dev 模式没有索引。要验证搜索必须 `build` 后 `preview`。

### Windows 上的 build 坑

`package.json` 的 build 脚本长这样：

```json
"build": "astro check && astro build && pagefind --site dist && cp -r dist/pagefind public/"
```

最后那个 `cp -r` 是 Unix 命令。在 **PowerShell / cmd 里直接 `npm run build` 会报 `cp 不是内部或外部命令`**，但 `astro build` 其实已经成功了，你会误以为构建失败。

解法二选一：

```bash
# A. 用 Git Bash 跑（最简单）
# B. 改脚本，跨平台
"build": "astro check && astro build && pagefind --site dist && node -e \"require('fs').cpSync('dist/pagefind','public/pagefind',{recursive:true})\""
```

### 开了代理时构建报 `Unsupported OpenType signature`（实测踩到）

这是最容易卡住人的一个。完整报错：

```
[ERROR] Caught error rendering /og.png: Error: Unsupported OpenType signature upst
    at ... @shuding/opentype.js ... satori ...
```

看起来像字体坏了，其实字体没坏。原理：

1. `src/pages/og.png.ts` 用 satori 生成 OG 图，需要读取字体文件的字节
2. 它调 `fetch(experimental_getFontFileURL(...))` 拿字体，这个 URL 指向**本地预渲染服务器**，形如 `http://[::]:60296/_astro/fonts/xxx.ttf`（IPv6 字面量）
3. 如果你的环境设了 `HTTP_PROXY` / `HTTPS_PROXY`（Clash、v2ray 等），Node 的 fetch 会把这个本地请求也发给代理
4. 代理不认识 `[::]` 这种 IPv6 地址，返回一段纯文本错误页，开头是 `upstream connect failed...`
5. satori 把这段文本当字体解析，读前 4 个字节 `upst` → 报 `Unsupported OpenType signature upst`

字体文件本身是好的（`dist/_astro/fonts/*.ttf` 魔数是 `00 01 00 00`），只是取的时候被换了内容。

**解法：让本地地址绕过代理。** 在构建命令前加环境变量：

```bash
# Git Bash / macOS / Linux
NO_PROXY="localhost,127.0.0.1,[::],::1" no_proxy="localhost,127.0.0.1,[::],::1" npm run build
```

```powershell
# PowerShell
$env:NO_PROXY="localhost,127.0.0.1,[::],::1"; npm run build
```

想一劳永逸，写进 `package.json`（跨平台，不依赖 shell）：

```json
"build": "cross-env NO_PROXY=\"localhost,127.0.0.1,[::],::1\" astro check && astro build && pagefind --site dist && cp -r dist/pagefind public/"
```

或者干脆关掉动态 OG 图——`features.dynamicOgImage: false`，同时删掉 `src/pages/og.png.ts`（这个路由是无条件预渲染的，不删照样报错），改用 `public/default-og.jpg` 作为全站默认 OG 图。**代价是所有文章共用一张 OG 图。**

> [!TIP]
> 判定方法：构建日志里 `/og.png` 后面紧跟着 `[ERROR] Unsupported OpenType signature`，且你的终端里 `env | grep -i proxy` 有输出 —— 就是这个问题，别再折腾字体了。

---

## 7. 改配色

改 `src/styles/theme.css`，不要碰组件：

```css
:root, [data-theme="light"] {
  --background: #fdfdfd;      /* 页面底色 */
  --foreground: #282728;      /* 正文文字 */
  --accent: #006cac;          /* 强调色：链接、按钮、下划线 */
  --accent-foreground: #ffffff;
  --muted: #e6e6e6;
  --muted-foreground: #6b7280;
  --border: #ece9e9;
}

[data-theme="dark"] {
  --background: #212737;
  --foreground: #eaedf3;
  --accent: #ff6b01;
  --accent-foreground: #ffffff;
  --muted: #343f60;
  --muted-foreground: #afb9ca;
  --border: #ab4b08;
}
```

改完立刻生效（Vite HMR）。这 7 个变量是 Tailwind v4 的 `@theme inline` 映射源，全站组件都读它们，所以不用改任何 class。

---

## 8. 中文化

主题的 UI 文案（"Posts"、"Tags"、"Read more"、"Table of contents" 等）走 i18n 层，但**只自带英文**。加中文要两步：

**第一步**：复制 `src/i18n/lang/en.ts` 为 `src/i18n/lang/zh-CN.ts`，把值翻译掉（key 不能动，类型是 `UIStrings`，漏 key 会编译报错）。

**第二步**：`astro.config.ts` 里加 locale：

```ts
i18n: {
  locales: ["en", "zh-CN"],
  defaultLocale: "zh-CN",
  routing: { prefixDefaultLocale: false },  // 中文站不加 /zh-CN 前缀
},
```

再把 `astro-paper.config.ts` 的 `site.lang` 设成 `"zh-CN"`。

`src/i18n/index.ts` 会自动 glob 加载 `lang/*.ts`，不用注册。找不到对应 locale 时回退英文。

---

## 9. 部署到 Cloudflare Workers

AstroPaper 默认 `output: "static"`，产出纯静态 `dist/`，**不需要 `@astrojs/cloudflare` 适配器**。用 Workers Static Assets 直接托管。

### 第一步：登录

```bash
npx wrangler@latest login
```

浏览器授权，选择你的账号。

### 第二步：加 `wrangler.jsonc`（项目根目录）

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-blog",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page"
  }
}
```

`not_found_handling: "404-page"` 让 Worker 用 `dist/404.html` 兜底，AstroPaper 自带 `404.astro`，正好。

### 第三步：构建并部署

```bash
npm run build
npx wrangler deploy
```

输出会给你一个 `https://my-blog.<你的子域>.workers.dev`。

### 第四步：绑自定义域名

Cloudflare Dashboard → Workers & Pages → 你的 Worker → Settings → Domains & Routes → Add custom domain。域名必须已托管在 Cloudflare（NS 指向 CF）。

### 自动化：推代码就上线

在 Dashboard 里给 Worker 接 Git 仓库（Workers Builds）：

- Build command：`npm run build`
- Deploy command：`npx wrangler deploy`
- Root directory：`/`

之后每次 `git push` 自动构建部署，PR 还会生成预览环境。

> [!TIP]
> 也可以继续用 Cloudflare Pages（`npx wrangler pages deploy dist`）。但 Pages 现在只维护不加新功能，新项目没理由选它。

---

## 10. 常见坑速查

| 现象 | 原因 | 解法 |
|---|---|---|
| `astro check` 报奇怪语法错 | Node 版本 < 22.12 | 升级 Node |
| 构建报 `cp 不是内部或外部命令` | Windows 下 build 脚本用了 Unix 命令 | 用 Git Bash 或改脚本 |
| 构建报 `Unsupported OpenType signature upst` | 代理拦截了本地预渲染服务器的请求 | 加 `NO_PROXY="localhost,127.0.0.1,[::],::1"` |
| 搜索框没结果 | dev 模式无 Pagefind 索引 | `build` + `preview` |
| 改 `src/config.ts` 不生效 | v6 已废弃，配置在根目录 | 改 `astro-paper.config.ts` |
| 社交图标不显示 | `socials.name` 对不上 SVG 文件名 | 检查 `src/assets/icons/socials/` |
| SEO 收录指向别人的站 | `site.url` 没改 | 改成自己的域名 |
| 文章 URL 和预期不符 | 用了 `slug` 字段 | v6 用文件路径决定 URL |
| OG 图不生成 | `dynamicOgImage: false` 且 `public/ogImage` 缺失 | 打开开关或放一张图 |
| 中文排版难看 | 字体只配了 Google Sans Code | 改 `astro.config.ts` 的 `fonts`，加中文字体回退 |
| git clone SSL 报错 | schannel 吊销检查失败 | `git config --global http.sslBackend openssl` |

---

## 11. 下一步能加什么

- **评论**：Giscus（GitHub Discussions，零后端）。仓库里有官方教程文章 `how-to-integrate-giscus-comments.md`
- **访问统计**：Cloudflare Web Analytics（免费、无 cookie）或 Umami
- **图片托管**：图片多了别放仓库，扔 R2，`wrangler r2 object put`
- **定时发布**：`draft: true` 批量管理，或配 GitHub Actions 定时触发部署

---

_核对时间：2026-10-18 ｜ 对应 commit：main 分支 v6.1.0_
