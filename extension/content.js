// 改文工坊 · 提示词自动填充
// 工坊跳转时把提示词放进 URL 的 #gw_prompt=<编码> 里。本脚本在 ChatGPT/Grok/Gemini
// 页面读出它,等输入框出现后填进去(不自动发送),然后从地址栏抹掉提示词。

(function () {
  function getPrompt() {
    const h = location.hash || ''
    const m = h.match(/[#&]gw_prompt=([^&]+)/)
    if (!m) return ''
    try {
      return decodeURIComponent(m[1])
    } catch {
      return ''
    }
  }

  // 找到当前页面的输入框(几个站结构不同,挨个试)
  function findEditor() {
    const sels = [
      '#prompt-textarea', // ChatGPT (ProseMirror contenteditable)
      'div[contenteditable="true"][translate="no"]', // Gemini / 通用 rich editor
      'textarea[placeholder]',
      'textarea',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
    ]
    for (const s of sels) {
      const el = document.querySelector(s)
      if (el && el.offsetParent !== null) return el
    }
    return null
  }

  function fill(el, text) {
    el.focus()
    const tag = el.tagName.toLowerCase()
    if (tag === 'textarea' || tag === 'input') {
      // 原生输入框:用原型 setter 赋值再触发 input,框架才认
      const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      // contenteditable(ChatGPT ProseMirror / Gemini):execCommand insertText
      // 会触发正确的 beforeinput/input 事件,编辑器内部状态才会更新
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      const ok = document.execCommand('insertText', false, text)
      if (!ok) {
        // 兜底:直接塞文本节点 + 派发 input
        el.textContent = text
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
      }
    }
  }

  function clearHash() {
    try {
      history.replaceState(null, '', location.pathname + location.search)
    } catch {
      /* ignore */
    }
  }

  function tryFill() {
    const text = getPrompt()
    if (!text) return false
    const el = findEditor()
    if (!el) return false
    fill(el, text)
    clearHash()
    // 轻提示:不自动发送,等用户回车
    console.log('[改文工坊] 提示词已填入,检查后按回车发送。')
    return true
  }

  // 直接用给定文本填(复用标签时由后台下发)
  function fillText(text) {
    if (!text) return
    let tries = 0
    const timer = setInterval(() => {
      tries++
      const el = findEditor()
      if (el) {
        fill(el, text)
        clearInterval(timer)
        console.log('[改文工坊] 提示词已填入,检查后按回车发送。')
      } else if (tries > 40) {
        clearInterval(timer)
      }
    }, 500)
  }

  function run() {
    if (!getPrompt()) return
    let tries = 0
    const timer = setInterval(() => {
      tries++
      if (tryFill() || tries > 40) clearInterval(timer)
    }, 500)
  }

  // 首次进入页面(新建标签带 hash 的情况)
  run()
  window.addEventListener('hashchange', run)

  // 复用已有标签:后台通过 sendMessage 下发提示词
  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'GW_FILL') fillText(msg.prompt)
    })
  }
  // executeScript 兜底注入用的自定义事件
  window.addEventListener('GW_FILL', (e) => fillText(e.detail))
})()
