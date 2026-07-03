# 自媒体图文工坊 · AImedia Content Studio

一套在你自己电脑本地运行的 AI 自媒体图文创作工具：从优秀范文里**提炼文案 / 画面风格** → 用风格卡**改文 / 原创** → **自动配图**。全程在本机完成，用你已有的 AI 工具账号，数据不出你电脑，完全开源可审查。

完整说明见 **[SKILL.md](./SKILL.md)**。

## 快速运行

```bash
npm install
npm run dev      # 工坊网页，http://localhost:5173（端口被占会自动换）
```

浏览器打开上面的网址即可。你要接哪个 AI、用什么接口，都在网页右上角「设置」里自己填；本工具不内置、不索取、不外传任何账号信息，所有配置只保存在你本机浏览器。

## 技术栈

Vite + React + TypeScript + React Router + Tailwind CSS + shadcn 风格组件 + lucide 图标。
