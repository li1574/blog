import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://blog.li1574.ccwu.cc/",
    title: "li1574的blog",
    description: "li1574 的个人博客，记录技术、折腾与思考。",
    author: "li1574",
    profile: "https://github.com/li1574",
    ogImage: "default-og.jpg",
    lang: "zh-CN",
    timezone: "Asia/Shanghai",
    dir: "ltr",
  },
  posts: {
    perPage: 6,
    perIndex: 5,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: false,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: true,
      url: "https://github.com/li1574/blog/edit/main/",
    },
    search: "pagefind",
  },
  socials: [
    { name: "github", url: "https://github.com/li1574" },
    { name: "mail", url: "mailto:li1574@example.com" },
  ],
  shareLinks: [
    { name: "x", url: "https://x.com/intent/post?url=" },
    { name: "telegram", url: "https://t.me/share/url?url=" },
    { name: "mail", url: "mailto:?subject=See%20this%20post&body=" },
  ],
});
