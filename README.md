# 自媒体图文工坊 · AImedia Content Studio

一套在本机运行的 AI 自媒体图文创作工具：从爆款里**提炼文案 / 画面风格** → 用风格卡**改文 / 原创** → **自动配图**。文字走你自己的 Claude / ChatGPT / Gemini 订阅额度（本地代理，不烧 API），配图走 OpenAI 兼容中转站或订阅手动出图。纯前端 + 本地代理，数据全存本机浏览器，不上传服务器。

完整说明见 **[SKILL.md](./SKILL.md)**。

## 快速运行

```bash
npm install
npm run proxy    # 本地订阅代理，端口 8788（用订阅额度时需要）
npm run dev      # 工坊网页，https://localhost:5173
```

首次打开提示"不安全"是本机自签证书，点「高级 → 继续前往」即可。所有 key / 地址在网页右上角「设置」里自己填，本包不预置任何 key。

## 技术栈

Vite + React + TypeScript + React Router + Tailwind CSS + shadcn 风格组件 + lucide 图标。
