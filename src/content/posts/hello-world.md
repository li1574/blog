---
title: "开始写第一篇文章"
description: "这个博客的格式约定、发文流程和几个能直接用的写法示例。"
pubDatetime: 2026-10-18T09:30:00+08:00
author: li1574
featured: true
tags:
  - 随笔
  - 使用说明
---

## 目录

这篇文章既是开张第一篇，也是写给自己的格式备忘。

## 怎么发文章

两种方式，随便挑：

1. **后台发文**：打开 `/admin`，填标题、摘要、正文，点发布。内容会提交到 GitHub 仓库，Cloudflare 自动重新构建，一两分钟后线上生效。
2. **本地写**：在 `src/content/posts/` 下新建 `.md` 文件，`git push`。文件名就是 URL。

后台的好处是不用开电脑上的编辑器，手机上也能写。

## frontmatter 只认三个必填项

```yaml
---
title: 文章标题
description: 一句话摘要，会出现在列表页和搜索结果里
pubDatetime: 2026-10-18T09:30:00+08:00
---
```

其余字段都可选：`tags`、`featured`、`draft`、`modDatetime`、`ogImage`、`canonicalURL`、`hideEditPost`。

> [!WARNING]
> 别在 frontmatter 里写 `slug`。这个主题不认它，URL 完全由文件路径决定。

## 正文从二级标题开始

frontmatter 的 `title` 已经是 `<h1>`，正文里再用 `#` 会出现两个一级标题。

```md
## 二级标题
### 三级标题
```

上面那个「目录」会自动变成可折叠的目录，靠的是 `## 目录` 这一行，位置写在哪目录就出现在哪。

## 几个能直接抄的写法

> [!TIP]
> 提示块，用 `> [!TIP]` 开头。

> [!NOTE]
> 还有 `NOTE` / `WARNING` / `DANGER` / `SUCCESS` / `QUESTION` / `EXAMPLE` 等类型。

代码块带文件名和行高亮：

```ts file="src/config.ts"
const site = "li1574的blog"; // [!code highlight]
const theme = "auto";
```

行内代码用反引号，比如 `npm run dev`。

## 图片放哪

| 位置 | 引用写法 | 是否自动压缩 |
| --- | --- | --- |
| `src/assets/images/` | `![说明](@/assets/images/x.jpg)` | 会 |
| `public/` | `![说明](/images/x.jpg)` | 不会 |

图片多的话别都塞仓库，以后可以换对象存储。

## 本地跑起来

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 构建，搜索索引也在这步生成
```

> [!IMPORTANT]
> `npm run dev` 里搜索框搜不出东西是正常的。Pagefind 索引只在 `build` 时生成，要验证搜索得 `build` 完再 `preview`。

---

就这些。剩下的边写边改。
