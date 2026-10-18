/**
 * 生成静态 OG 图（1200x630）。
 * 用法：node scripts/make-og.mjs
 *
 * 为什么不用动态 OG：satori 只认显式传入的字体，主题自带的
 * Google Sans Code 没有中文字形，中文会渲染成方块。
 * 这里直接读系统里的中文字体，一次性出图，构建时不再依赖字体下载。
 */
import fs from "node:fs";
import path from "node:path";
import satori from "satori";
import sharp from "sharp";

const FONT_DIR = "C:/Windows/Fonts";
const regular = fs.readFileSync(path.join(FONT_DIR, "Deng.ttf"));
const bold = fs.readFileSync(path.join(FONT_DIR, "Dengb.ttf"));

const title = "li1574的blog";
const subtitle = "记录技术、折腾与思考";
const host = "blog.li1574.ccwu.cc";

const svg = await satori(
  {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "#fdfdfd",
        fontFamily: "Deng",
        padding: "0 80px",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              width: "100%",
              height: "100%",
              border: "3px solid #282728",
              borderRadius: "6px",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              padding: "40px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: { fontSize: 84, fontWeight: 700, color: "#282728", letterSpacing: "-1px" },
                  children: title,
                },
              },
              {
                type: "div",
                props: {
                  style: { marginTop: 28, fontSize: 34, color: "#6b7280" },
                  children: subtitle,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    marginTop: 56,
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                  },
                  children: [
                    {
                      type: "div",
                      props: { style: { width: 56, height: 4, background: "#006cac" } },
                    },
                    {
                      type: "div",
                      props: { style: { fontSize: 26, color: "#006cac" }, children: host },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  },
  {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Deng", data: regular, weight: 400, style: "normal" },
      { name: "Deng", data: bold, weight: 700, style: "normal" },
    ],
  }
);

const out = path.resolve("public/default-og.jpg");
await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(out);
console.log("written:", out);
