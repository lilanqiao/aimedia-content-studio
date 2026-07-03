// 后台:接收改文工坊页发来的消息,把提示词送到对应平台的标签页。
// 始终复用同一个标签:找到已有的(chatgpt/grok/gemini)就聚焦+填,没有才新建。

const HOSTS = {
  chatgpt: { match: ['*://chatgpt.com/*', '*://chat.openai.com/*'], open: 'https://chatgpt.com/' },
  grok: { match: ['*://grok.com/*'], open: 'https://grok.com/imagine' },
  gemini: { match: ['*://gemini.google.com/*'], open: 'https://gemini.google.com/' },
}

function platformOf(url) {
  if (/grok\.com/.test(url)) return 'grok'
  if (/gemini\.google\.com/.test(url)) return 'gemini'
  return 'chatgpt'
}

async function deliver({ url, prompt }) {
  const plat = platformOf(url)
  const conf = HOSTS[plat]
  // 找已有标签
  const tabs = await chrome.tabs.query({ url: conf.match })
  if (tabs.length > 0) {
    const tab = tabs[0]
    await chrome.windows.update(tab.windowId, { focused: true })
    await chrome.tabs.update(tab.id, { active: true })
    // 直接让该标签的 content 填(不走 hash,避免被抹后对不上)
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'GW_FILL', prompt })
    } catch {
      // content 还没注入(比如刚导航),用脚本兜底注入再填
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (p) => window.dispatchEvent(new CustomEvent('GW_FILL', { detail: p })),
        args: [prompt],
      })
    }
    return { ok: true, reused: true }
  }
  // 没有就新建一个,带上 hash 让 content 首次加载时填
  const sep = conf.open.includes('#') ? '&' : '#'
  await chrome.tabs.create({ url: `${conf.open}${sep}gw_prompt=${encodeURIComponent(prompt)}` })
  return { ok: true, reused: false }
}

// 来自工坊页桥接脚本(bridge.js)的内部消息
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'GW_OPEN') {
    deliver(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true // 异步响应
  }
})
