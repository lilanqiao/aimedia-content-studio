---
name: 自媒体图文工坊
description: 自媒体图文工坊 —— 一套在你自己电脑本地运行的 AI 自媒体图文创作工具。核心玩法：先从爆款范文里「提炼文案风格」和「提炼画面风格」，再用提炼出的风格卡去「改写」别人的文案、或就一个主题「原创」新文案，并按画面风格自动「配图」。适合做小红书 / 公众号 / 抖音图文的创作者：把"我想模仿某种风格"变成"可复用的风格卡 + 成品文案 + 配图"。文字走你自己的 Claude / ChatGPT / Gemini 订阅额度（本地代理，不烧 API token），配图走 OpenAI 兼容中转站或订阅手动出图。纯前端 + 本地代理，数据全存本机浏览器，不上传任何服务器，不预置任何 key。
---

# 自媒体图文工坊（AImedia Content Studio）

## 这是什么

一套**在你自己电脑上跑**的 AI 自媒体图文创作工坊。核心思路一句话：

> **先从爆款里「提炼风格」 → 再「套用风格」批量产出文案 → 顺手「配图」**

全程用你自己的订阅额度，数据不出本机。它**不预置任何现成风格**——风格由你自己从范文里提炼，存成「风格卡」反复复用。

## 六大板块

| 板块 | 干什么 |
|---|---|
| **提炼文案风格** | 丢范文 / 字幕 / 文档 / 图片 → AI 拆解文字套路 → 生成可复用的「文案风格卡」 |
| **提炼画面风格** | 丢参考图 / 描述 → AI 拆解画面套路 → 生成「画面风格卡」 |
| **原创文** | 选一张文案风格卡 + 给个主题 → 按这套风格原创新文案 |
| **改文** | 选一张文案风格卡 + 粘贴一篇文案 → 按这套风格改写，右侧多版本流式输出 |
| **配图** | 文案 + 画面风格卡 → 出图（中转站自动出图 / 订阅模式给提示词手动出） |
| **历史** | 提炼过的风格、生成过的文案 / 图都存本机，可回看复用 |

## 两条线路（在右上角「设置」里选）

- **文字**（提炼 / 改文 / 原创文）：默认走**订阅**——本地代理把请求按模型名分流到你本机登录的官方 CLI，用你自己的额度，不花 API token：
  - Claude（`claude -p`，订阅 OAuth）
  - ChatGPT / GPT-5.5（`codex exec`，需 ChatGPT 订阅）
  - Gemini（`gemini -p`，需先在 CLI 登录 Google）
  - 也可切「中转站」：填任意 OpenAI 兼容地址 + key。
- **配图**：默认走**中转站**（填自己的 key，自动出图，模型 gpt-image）；没有 key 就选「订阅·手动」——它给你提示词 + 一键打开 ChatGPT / Gemini，你自己出图贴回来。

> 本包**不预置任何 key、不指向任何人的代理**。所有 key / 地址都要你自己在「设置」里填。

## 怎么用起来（不用懂技术）

打开你的 AI 编程助手（Claude Code / Codex 等），把下面这段**原样发给它**，它会自动下载并跑起来：

```
帮我把这个开源项目在本机跑起来用：https://github.com/lilanqiao/aimedia-content-studio
请你：
1. git clone 这个仓库到本地并进入目录；
2. 装好依赖（npm install；没装 node 就先帮我装）；
3. 后台同时启动并保持运行：`npm run proxy`（端口 8788）和 `npm run dev`（端口 5173）；
4. 把要打开的网址告诉我；
5. 起不来 / 端口被占你自己排查，直到我能正常打开为止。
```

AI 会自动 clone、装好、跑起来，给你一个网址（一般是 `http://localhost:5173`，端口被占会自动换一个，以 AI 报给你的为准），浏览器直接打开就能用。

关机后再用：让你的 AI 助手进入那个目录，重新跑 `npm run proxy` 和 `npm run dev` 即可。

> 源码仓库：**https://github.com/lilanqiao/aimedia-content-studio** —— 完整开源，本机运行，数据不出你电脑。

## 技术栈

Vite + React + TypeScript + React Router + Tailwind CSS + shadcn 风格组件 + lucide 图标。
本地代理 `server/claude-proxy.mjs`：把 OpenAI 兼容的 `/v1/chat/completions` 按模型名分流到三家官方 CLI。

## 目录

```
src/
  pages/        PromptStudio(提炼文案/画面风格) · Studio(原创文/改文) · Image(配图) · History(历史)
  components/   顶栏、品牌、设置弹窗、风格卡编辑弹窗、ui 基础组件
  lib/          store(本地存储) · llm(流式调用) · metaPrompt(提炼用元提示词) · types
server/
  claude-proxy.mjs   本地订阅代理（claude / codex / gemini 三后端分流）
extension/       浏览器扩展（抓取素材辅助）
```

## 隐私

纯前端 + 本地代理。风格卡、文案、图片、API 配置**全部只存在你本机浏览器 localStorage**，不上传任何服务器。
