# li1574的blog

个人博客源码。纯静态，Astro 构建，部署在 Cloudflare Workers 上。

- 站点：https://blog.li1574.ccwu.cc/
- 发文后台：https://blog.li1574.ccwu.cc/admin
- 主题：[AstroPaper](https://github.com/satnaing/astro-paper) v6（MIT）

## 技术栈

| 层 | 用什么 |
| --- | --- |
| 框架 | Astro 7（`output: static`） |
| 样式 | Tailwind CSS 4 |
| 搜索 | Pagefind（构建时生成索引，无后端） |
| 发文 | Workers + GitHub Contents API，见 `worker/index.ts` |
| 托管 | Cloudflare Workers Static Assets |

## 本地开发

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # 类型检查 + 构建 + 搜索索引
npm run preview    # 预览构建产物
```

> Node 版本必须 ≥ 22.12.0。

只测静态页面用 `npm run dev` 就够；要测发文接口得用 `npx wrangler dev`，并在 `.dev.vars` 里写好 `GITHUB_TOKEN` 和 `ADMIN_PASSWORD`。

## 发文

两种方式：

1. 打开 `/admin`，填标题、摘要、正文，点发布。内容会以 commit 形式提交到本仓库，Cloudflare 自动重新构建上线。
2. 在 `src/content/posts/` 下新建 `.md` 文件，`git push`。

文章格式见 `src/content/posts/hello-world.md`，frontmatter 只有 `title`、`description`、`pubDatetime` 是必填。

**URL 由文件路径决定**，frontmatter 里写 `slug` 无效。

## 目录结构

```
astro-paper.config.ts   站点配置（站点名、域名、社交链接、功能开关）
astro.config.ts         Astro 配置（字体、i18n、Markdown 插件）
worker/index.ts         发文 API
public/admin/           发文界面
src/content/posts/      文章
src/content/pages/      独立页面（关于等）
src/i18n/lang/          UI 文案（zh-CN / en）
src/styles/theme.css    配色变量
scripts/                构建辅助脚本
```

## 部署

```bash
npm run deploy        # = npm run build && wrangler deploy
```

首次部署需要设置两个密钥（必须用 `printf`，`echo` 会把换行写进密钥）：

```bash
printf '%s' 'github_pat_xxx' | npx wrangler secret put GITHUB_TOKEN
printf '%s' '口令' | npx wrangler secret put ADMIN_PASSWORD
```

完整运维说明见 [`docs/部署说明.md`](docs/部署说明.md)，主题使用教程见 [`docs/AstroPaper-使用教程.md`](docs/AstroPaper-使用教程.md)。

## 几个约定

- 正文字号、行高、配色改 `src/styles/theme.css` 的 CSS 变量，不要改组件
- 动态 OG 图已关闭（satori 没有中文字形，中文会渲染成方块），用 `scripts/make-og.mjs` 生成静态图
- OG 图以 base64 存在 `scripts/default-og.jpg.b64`，`prebuild` 时还原，仓库里不放二进制文件
- 字体只有 Google Sans Code（拉丁字符），中文走系统字体回退

## License

代码 MIT。文章内容版权归作者所有。
