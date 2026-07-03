// 会话级内存缓存:在板块之间切换(路由切换 = 组件卸载/重挂)时不丢内容。
// 专治图片素材 / 出图结果——它们是 base64,体积大,塞 localStorage 会超配额静默丢失。
// 内存里不受配额限制;整页刷新才清空,或用户手动点「清空」。
const mem: Record<string, unknown> = {}

export function cacheGet<T>(key: string, fallback: T): T {
  return key in mem ? (mem[key] as T) : fallback
}

export function cacheSet(key: string, val: unknown): void {
  mem[key] = val
}
