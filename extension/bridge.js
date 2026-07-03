// 桥接脚本:注入到改文工坊页面(localhost)。
// 1) 在页面 DOM 上插一个标记,让网页知道"插件已装",从而不再回退开新标签。
// 2) 接收网页 postMessage 的出图/出视频请求,转发给后台(内部通信,稳定可靠)。

document.documentElement.setAttribute('data-gw-ext', '1')

window.addEventListener('message', (e) => {
  if (e.source !== window) return
  const d = e.data
  if (!d || d.__gw !== 'GW_OPEN') return
  chrome.runtime.sendMessage({ type: 'GW_OPEN', url: d.url, prompt: d.prompt })
})
