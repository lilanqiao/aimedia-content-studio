#!/usr/bin/env node
// 本地代理:把 OpenAI 兼容的 /v1/chat/completions 请求,按模型名分流到三个订阅 CLI
// (走你各自的登录态/订阅,不烧 API token),再把输出回吐成 OpenAI SSE。
//
//   claude*/opus/sonnet/haiku  ->  claude -p   (Claude 订阅,真流式)
//   gpt*/o1/o3/5.5/codex       ->  codex exec  (ChatGPT 订阅;一次性返回)
//   gemini*                    ->  gemini -p   (Gemini 账号;一次性返回)
//
// 用法: node server/claude-proxy.mjs   (默认端口 8788,PORT 可改)
// 工坊模型配置:中转站地址 http://localhost:8788/v1,Key 随便填。仅文本。

import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

const PORT = process.env.PORT ? Number(process.env.PORT) : 8788

// Gemini 后端命令:Gemini CLI 个人版免费层 2026-06-18 停服,后继是 Antigravity CLI。
// 启动时探测——装了 antigravity 就优先用它,否则回退 gemini。这样 6/18 那天
// 一旦装上 antigravity 会自动切换,无需改代码。可用 GEMINI_BACKEND_CMD 手动指定。
const GEMINI_CMD = (() => {
  if (process.env.GEMINI_BACKEND_CMD) return process.env.GEMINI_BACKEND_CMD
  try {
    const r = spawnSync('antigravity', ['--version'], { stdio: 'ignore' })
    if (!r.error) return 'antigravity'
  } catch { /* not installed */ }
  return 'gemini'
})()

// gbrain CLI 解析:launchd 启动时 PATH 很干净,bun/gbrain 不在里面,所以
// 显式找绝对路径 + 把常见 bin 目录补进 env.PATH,保证子进程能调到 gbrain。
function gbrainCmd() {
  const home = os.homedir()
  const bin = [`${home}/.bun/bin/gbrain`, '/opt/homebrew/bin/gbrain', '/usr/local/bin/gbrain']
    .find((p) => { try { return fs.existsSync(p) } catch { return false } }) || 'gbrain'
  const env = { ...process.env, PATH: (process.env.PATH || '') + `:${home}/.bun/bin:/opt/homebrew/bin:/usr/local/bin` }
  return { bin, env }
}
// 剥掉 gbrain get 返回的 YAML frontmatter,只留正文
function stripFrontmatter(s = '') {
  const m = /^---\n[\s\S]*?\n---\n+/.exec(s)
  return m ? s.slice(m[0].length) : s
}
// 图文工坊成品的知识库 = Obsidian 库里的一个文件夹。成品存成 .md 放这,
// 用户在 Obsidian 里能直接翻看/编辑/管理;"从知识库更新风格卡"也读这个文件夹。
// (未来要 Hermes 语义检索,再 `gbrain import` 这个文件夹即可,东西一篇不丢。)
const KB_DIR = path.join(os.homedir(), 'Obsidian知识库', '图文工坊成品')

function pickBackend(model = '') {
  const m = String(model).toLowerCase()
  if (m.includes('gemini')) return 'gemini'
  if (/gpt|codex|o1|o3|5\.5/.test(m)) return 'codex'
  return 'claude'
}
function claudeAlias(model = '') {
  const m = String(model).toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  return 'opus'
}

// 把消息里的 image_url(base64 data URL)存成临时图片文件,返回路径——
// 让 claude -p / codex exec 用各自的读图能力去看图(纯文本 CLI 也就能"看图"了)。
// 5 分钟后自动删,够 CLI 这一轮读完。远程 http 图跳过(CLI 不便去拉)。
function saveDataUrlImage(dataUrl) {
  const m = /^data:image\/([a-z0-9]+);base64,(.+)$/is.exec(String(dataUrl || ''))
  if (!m) return null
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()
  const file = path.join(os.tmpdir(), `vis-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
  try {
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'))
    setTimeout(() => { try { fs.unlinkSync(file) } catch { /* ignore */ } }, 5 * 60 * 1000)
    return file
  } catch { return null }
}

function buildPrompt(messages = []) {
  const sys = []
  const turns = []
  const imgPaths = []
  for (const msg of messages) {
    let text
    if (Array.isArray(msg.content)) {
      const ts = []
      for (const p of msg.content) {
        if (p.type === 'text') ts.push(p.text)
        else if (p.type === 'image_url' && p.image_url?.url) {
          const f = saveDataUrlImage(p.image_url.url)
          if (f) imgPaths.push(f)
        }
      }
      text = ts.join('\n')
    } else {
      text = String(msg.content ?? '')
    }
    if (!text.trim()) continue
    if (msg.role === 'system') sys.push(text)
    else if (msg.role === 'user') turns.push(text)
    else if (msg.role === 'assistant') turns.push(`(上一轮你的回复)\n${text}`)
  }
  const head = sys.length ? `${sys.join('\n\n')}\n\n———\n\n` : ''
  let prompt = head + turns.join('\n\n')
  if (imgPaths.length) {
    prompt +=
      `\n\n———\n【用户提供了下面这些图片文件,请用你的读图/查看文件能力直接打开它们来看图分析,不要说你看不了图】\n` +
      imgPaths.map((p, i) => `图片${i + 1}: ${p}`).join('\n')
  }
  return prompt
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}
const now = () => Math.floor(Date.now() / 1000)
function sseDelta(id, model, content) {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created: now(), model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`
}
function sseEnd(res, id, model) {
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: now(), model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}
function finishOnce(res, id, model, text, wantStream) {
  if (wantStream) {
    if (text) res.write(sseDelta(id, model, text))
    sseEnd(res, id, model)
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id, object: 'chat.completion', created: now(), model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    }))
  }
}
function failOnce(res, id, model, msg, wantStream) {
  if (wantStream) { res.write(sseDelta(id, model, `\n[代理错误] ${msg}`)); sseEnd(res, id, model) }
  else { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: msg } })) }
}

// ---- Claude:真流式(stream-json) ----
function runClaude(res, id, model, prompt, wantStream) {
  const child = spawn('claude',
    ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--model', claudeAlias(model)],
    { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.write(prompt); child.stdin.end()
  if (wantStream) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  let buf = '', full = '', err = ''
  child.stderr.on('data', (d) => (err += d))
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim(); if (!t) continue
      let o; try { o = JSON.parse(t) } catch { continue }
      if (o.type === 'stream_event' && o.event?.type === 'content_block_delta') {
        const text = o.event.delta?.text
        if (text) { full += text; if (wantStream) res.write(sseDelta(id, model, text)) }
      }
    }
  })
  child.on('close', (code) => {
    if (code !== 0 && !full) return failOnce(res, id, model, err.trim() || `claude exited ${code}`, wantStream)
    if (wantStream) sseEnd(res, id, model)
    else finishOnce(res, id, model, full, false)
  })
  res.on('close', () => { if (!res.writableEnded && !child.killed) child.kill() })
}

// ---- codex:一次性,用 -o 取最终消息 ----
function runCodex(res, id, model, prompt, wantStream) {
  const out = path.join(os.tmpdir(), `codex-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const child = spawn('codex', ['exec', '--skip-git-repo-check', '-o', out, '-'], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.write(prompt); child.stdin.end()
  let err = ''
  child.stdout.on('data', (d) => (err += d)) // codex 把进度也打到 stdout,留作出错时参考
  child.stderr.on('data', (d) => (err += d))
  child.on('close', () => {
    let text = ''
    try { text = fs.readFileSync(out, 'utf8').trim(); fs.unlinkSync(out) } catch { /* ignore */ }
    if (!text) {
      const limit = /usage limit|hit your.*limit/i.test(err)
      return failOnce(res, id, model, limit ? 'ChatGPT/Codex 订阅额度已用满,等额度恢复或升级 Plus' : (err.trim().slice(-300) || 'codex 无输出'), wantStream)
    }
    finishOnce(res, id, model, text, wantStream)
  })
  res.on('close', () => { if (!res.writableEnded && !child.killed) child.kill() })
}

// ---- gemini / antigravity:一次性,捕获 stdout,带瞬时失败自动重试 ----
function geminiAttempt(model, prompt, onChild) {
  // gemini 与 antigravity(后继 CLI)沿用同一套 headless 参数(-p/--skip-trust);
  // 若 antigravity 正式版参数有出入,到时按其 --help 调一下这里即可。
  const args = ['-p', prompt, '--skip-trust']
  if (model && model.toLowerCase().includes('gemini')) { args.push('-m', model) }
  return new Promise((resolve) => {
    const child = spawn(GEMINI_CMD, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: 'true' } })
    onChild(child)
    let out = '', err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => resolve({ text: '', err: String(e) }))
    child.on('close', () => resolve({ text: out.trim(), err }))
  })
}

// gemini-3.x preview 偶尔把 thinking/meta 块漏到正文最前面(类似:
//   "待thought\nCRITICAL INSTRUCTION 1: ...\nI will directly output..."),
// 这里在交付前剥掉:把开头连续的 ASCII-only 段落(thinking 用英文/伪命令写)
// 全部丢掉,直到第一段以中文字符开头的段。
function stripGeminiThinkingLeak(text) {
  if (!text) return text
  const paras = text.split(/\n{2,}/)
  let i = 0
  let salvaged = '' // 最后一段 meta 里可能粘着正文首句,救回来
  for (; i < paras.length; i++) {
    const p = paras[i].trim()
    if (!p) continue
    const isMeta =
      /^(待thought|thought\s*:|CRITICAL INSTRUCTION|I will (directly )?output|<thinking|<\/?think>)/i.test(p) ||
      !/[一-鿿]/.test(p)
    if (!isMeta) break
    // meta 段里若混了中文(模型把正文首句粘在 meta 尾巴上),从第一个中文字符切回来
    const firstCn = p.search(/[一-鿿]/)
    if (firstCn >= 0) salvaged = p.slice(firstCn)
  }
  const tail = paras.slice(i).join('\n\n').trim()
  const out = (salvaged && tail) ? `${salvaged}\n\n${tail}` : (tail || salvaged)
  return out || text
}

async function runGemini(res, id, model, prompt, wantStream) {
  let aborted = false
  let cur = null
  res.on('close', () => { aborted = true; if (!res.writableEnded && cur && !cur.killed) cur.kill() })

  const MAX = 3
  let last = { text: '', err: '' }
  for (let attempt = 1; attempt <= MAX && !aborted; attempt++) {
    last = await geminiAttempt(model, prompt, (c) => (cur = c))
    if (last.text) {
      const cleaned = stripGeminiThinkingLeak(last.text)
      if (cleaned !== last.text) console.log(`[proxy] gemini 剥除 thinking 泄漏: -${last.text.length - cleaned.length}字`)
      return finishOnce(res, id, model, cleaned, wantStream)
    }
    // 确定性错误:重试也没用,直接如实报,不浪费
    if (/verify your account|ValidationRequired|403/i.test(last.err)) {
      return failOnce(res, id, model, 'Gemini 账号需先验证(CLI 报 403 Verify your account)', wantStream)
    }
    if (/RESOURCE_EXHAUSTED|429|quota|rate.?limit/i.test(last.err)) {
      return failOnce(res, id, model, 'Gemini 免费层频率/额度到顶,稍后再试或切 Claude', wantStream)
    }
    // 瞬时抖动:退避后重试
    if (attempt < MAX && !aborted) { console.log(`[proxy] gemini 第${attempt}次抖动,重试`); await new Promise((r) => setTimeout(r, 600 * attempt)) }
  }
  if (!aborted) failOnce(res, id, model, last.err.trim().slice(-300) || `gemini ${MAX}次均无输出`, wantStream)
}

// ---- 抖音链接 → 作品文案(短链 302 跳 iesdouyin 分享页,HTML 里带 desc)----
const DY_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

async function extractDouyin(rawUrl) {
  const m = String(rawUrl).match(/https?:\/\/[^\s"']+/)
  if (!m) throw new Error('没找到链接')
  const r = await fetch(m[0], { headers: { 'User-Agent': DY_UA }, redirect: 'follow' })
  const html = await r.text()
  const idMatch = r.url.match(/video\/(\d+)/) || html.match(/aweme_id":"?(\d+)/)
  const tryPats = [
    /"desc":"([^"]{1,400})"/,
    /<meta[^>]+og:description[^>]+content="([^"]+)"/,
    /"share_title":"([^"]{1,400})"/,
  ]
  let desc = ''
  for (const p of tryPats) {
    const mm = html.match(p)
    if (mm) {
      try {
        desc = JSON.parse('"' + mm[1].replace(/"/g, '\\"') + '"')
      } catch {
        desc = mm[1]
      }
      break
    }
  }
  if (!desc) throw new Error('页面里没解析到文案(可能被反爬或需要 cookie)')
  return { desc, videoId: idMatch ? idMatch[1] : '', finalUrl: r.url }
}

// ---- 视频/音频 → 逐字稿(mlx-whisper 转写 + claude 纠错别字)----
const WHISPER_PY = path.join(import.meta.dirname, '.venv-whisper', 'bin', 'python')
const TRANSCRIBE_PY = path.join(import.meta.dirname, 'transcribe.py')

// 非流式跑一次 claude -p,返回纯文本(用于纠错校对)
function claudeOnce(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', 'sonnet'], { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.write(prompt)
    child.stdin.end()
    let out = '', err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `claude exit ${code}`))))
  })
}

// 先把视频/音频用 ffmpeg 压成 16k 单声道 mp3(whisper 只需要这个,体积小、解码快)
function toAudio16k(srcPath) {
  return new Promise((resolve) => {
    const out = srcPath + '.16k.mp3'
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', srcPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', out])
    p.on('error', () => resolve(srcPath)) // 没 ffmpeg 就用原文件
    p.on('close', (code) => resolve(code === 0 && fs.existsSync(out) ? out : srcPath))
  })
}

async function transcribeFile(filePath) {
  const audioPath = await toAudio16k(filePath)
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(WHISPER_PY, [TRANSCRIBE_PY, audioPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (audioPath !== filePath) { try { fs.unlinkSync(audioPath) } catch { /* ignore */ } }
      code === 0 ? resolve(out.trim()) : reject(new Error('转写失败: ' + err.trim().slice(-300)))
    })
  })
  if (!raw) return { raw: '', clean: '' }
  let clean = raw
  try {
    clean = await claudeOnce(
      `你是中文转写校对。下面是语音转写稿,可能有同音/近音错别字、缺标点。请结合语境改正错别字、补好标点、合理分段,只输出改正后的逐字稿正文,不要任何解释。\n\n———\n\n${raw}`
    )
  } catch { /* 纠错失败就用原始稿 */ }
  return { raw, clean }
}

// ---- 视频 → 抽若干帧(ffmpeg),给视觉模型看画面 ----
function ffprobeDuration(filePath) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath])
    let o = ''
    p.stdout.on('data', (d) => (o += d))
    p.on('error', () => resolve(0))
    p.on('close', () => resolve(parseFloat(o.trim()) || 0))
  })
}

async function extractFrames(filePath, count) {
  const dur = await ffprobeDuration(filePath)
  const n = Math.max(1, Math.min(count || 6, 10))
  const frames = []
  for (let i = 0; i < n; i++) {
    const t = dur > 0 ? (dur * (i + 0.5)) / n : i
    const out = path.join(os.tmpdir(), `fr-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.jpg`)
    await new Promise((resolve) => {
      const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', filePath, '-frames:v', '1', '-vf', 'scale=640:-1', '-q:v', '3', out])
      p.on('error', () => resolve())
      p.on('close', () => resolve())
    })
    try {
      const b = fs.readFileSync(out)
      frames.push('data:image/jpeg;base64,' + b.toString('base64'))
      fs.unlinkSync(out)
    } catch { /* 这帧没出来,跳过 */ }
  }
  if (!frames.length) throw new Error('抽帧失败(ffmpeg 没产出)')
  return frames
}

// ---- 抖音链接 → 下载视频(Playwright,跑在用户机器的真实网络上)----
const DY_PY = path.join(import.meta.dirname, '.venv-dy', 'bin', 'python')
const DY_FETCH = path.join(import.meta.dirname, 'dy_fetch.py')

function dyFetchVideo(url) {
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), `dyv-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`)
    const child = spawn(DY_PY, [DY_FETCH, url, out], { stdio: ['ignore', 'pipe', 'pipe'] })
    let so = '', se = ''
    child.stdout.on('data', (d) => (so += d))
    child.stderr.on('data', (d) => (se += d))
    child.on('error', reject)
    child.on('close', () => {
      let info = {}
      try { info = JSON.parse(so.trim().split('\n').pop()) } catch { /* ignore */ }
      if (info.ok && fs.existsSync(out)) resolve({ path: out, caption: info.caption || '' })
      else reject(new Error(info.error || se.trim().slice(-300) || '抖音视频下载失败'))
    })
  })
}

// ---- 可选:飞书多维表格同步(默认关闭,需自行在环境变量里配置凭证才生效)----
const FEISHU = {
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
  appToken: process.env.FEISHU_APP_TOKEN || '',
  tableId: process.env.FEISHU_TABLE_ID || '',
  base: 'https://open.feishu.cn',
}
async function feishuToken() {
  const r = await fetch(`${FEISHU.base}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU.appId, app_secret: FEISHU.appSecret }),
  })
  const j = await r.json()
  if (!j.tenant_access_token) throw new Error('飞书鉴权失败: ' + (j.msg || ''))
  return j.tenant_access_token
}
async function feishuAddRecord({ kind, title, content }) {
  const tok = await feishuToken()
  const r = await fetch(
    `${FEISHU.base}/open-apis/bitable/v1/apps/${FEISHU.appToken}/tables/${FEISHU.tableId}/records`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({
        fields: {
          类型: kind === 'rewrite' ? '改文' : kind === 'prompt' ? '提示词' : kind === 'transcript' ? '逐字稿' : kind,
          标题: title || '',
          内容: content || '',
          时间: new Date().toLocaleString('zh-CN', { hour12: false }),
        },
      }),
    }
  )
  const j = await r.json()
  if (j.code !== 0) throw new Error('写入飞书失败: ' + (j.msg || JSON.stringify(j).slice(0, 200)))
  return true
}

const server = http.createServer((req, res) => {
  cors(res)
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (req.method === 'GET' && req.url?.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, backends: ['claude', 'codex', 'gemini'], port: PORT }))
  }
  // 代下载图片:GET /img-download?url=...&name=... —— 服务端拉取图床图片,以附件返回,绕开跨域。
  if (req.url?.startsWith('/img-download') && req.method === 'GET') {
    const u = new URL(req.url, `http://localhost:${PORT}`)
    const target = u.searchParams.get('url') || ''
    const name = u.searchParams.get('name') || 'image.png'
    if (!/^https?:\/\//.test(target)) { res.writeHead(400); return res.end('bad url') }
    // 带浏览器 UA + Referer:有些图床(阿里云 OSS)对裸请求返回 403。
    fetch(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Referer: 'https://www.geeknow.top/',
      },
    })
      .then(async (r) => {
        if (!r.ok) { res.writeHead(502); return res.end('fetch failed') }
        const ct = r.headers.get('content-type') || 'image/png'
        const buf = Buffer.from(await r.arrayBuffer())
        res.writeHead(200, {
          'Content-Type': ct,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
        })
        res.end(buf)
      })
      .catch((e) => { res.writeHead(502); res.end(String(e.message || e)) })
    return
  }
  // 同步一条到飞书多维表格:POST {kind, title, content}
  if (req.url?.startsWith('/feishu-sync') && req.method === 'POST') {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      let p
      try { p = JSON.parse(b) } catch { res.writeHead(400); return res.end('bad json') }
      feishuAddRecord(p)
        .then(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })) })
        .catch((e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })) })
    })
    return
  }
  // 抖音链接抓文案:GET /extract?url=... 或 POST {url}
  if (req.url?.startsWith('/extract')) {
    const done = (urlStr) => {
      extractDouyin(urlStr)
        .then((data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) })
        .catch((e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })) })
    }
    if (req.method === 'GET') {
      const u = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('url') || ''
      return done(u)
    }
    if (req.method === 'POST') {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => { try { done(JSON.parse(b).url || '') } catch { res.writeHead(400); res.end('bad json') } })
      return
    }
  }
  // 抖音链接 → 下载视频 → 抽帧:POST {url, count}
  if (req.url?.startsWith('/dy-frames') && req.method === 'POST') {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      let p
      try { p = JSON.parse(b) } catch { res.writeHead(400); return res.end('bad json') }
      dyFetchVideo(p.url || '')
        .then(async ({ path: vp }) => {
          try {
            const frames = await extractFrames(vp, p.count)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ frames }))
          } finally { try { fs.unlinkSync(vp) } catch { /* ignore */ } }
        })
        .catch((e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })) })
    })
    return
  }
  // 抖音链接 → 下载视频 → 转逐字稿:POST {url}
  if (req.url?.startsWith('/dy-transcribe') && req.method === 'POST') {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      let p
      try { p = JSON.parse(b) } catch { res.writeHead(400); return res.end('bad json') }
      dyFetchVideo(p.url || '')
        .then(async ({ path: vp }) => {
          try {
            const r = await transcribeFile(vp)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(r))
          } finally { try { fs.unlinkSync(vp) } catch { /* ignore */ } }
        })
        .catch((e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })) })
    })
    return
  }
  // 视频 → 抽帧:POST {data: base64, ext, count}
  if (req.url?.startsWith('/frames') && req.method === 'POST') {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      let p
      try { p = JSON.parse(b) } catch { res.writeHead(400); return res.end('bad json') }
      const data = p.data || ''
      const ext = (p.ext || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp4'
      const b64 = data.includes(',') ? data.split(',')[1] : data
      const tmp = path.join(os.tmpdir(), `fv-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
      try { fs.writeFileSync(tmp, Buffer.from(b64, 'base64')) } catch { res.writeHead(400); return res.end(JSON.stringify({ error: '文件解码失败' })) }
      extractFrames(tmp, p.count)
        .then((frames) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ frames })) })
        .catch((e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })) })
        .finally(() => { try { fs.unlinkSync(tmp) } catch { /* ignore */ } })
    })
    return
  }
  // 文件 → 逐字稿:POST {data: base64, ext}
  if (req.url?.startsWith('/transcribe') && req.method === 'POST') {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      let p
      try { p = JSON.parse(b) } catch { res.writeHead(400); return res.end('bad json') }
      const data = p.data || ''
      const ext = (p.ext || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp4'
      const b64 = data.includes(',') ? data.split(',')[1] : data
      const tmp = path.join(os.tmpdir(), `tr-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
      try { fs.writeFileSync(tmp, Buffer.from(b64, 'base64')) } catch { res.writeHead(400); return res.end(JSON.stringify({ error: '文件解码失败' })) }
      transcribeFile(tmp)
        .then((r) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)) })
        .catch((e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })) })
        .finally(() => { try { fs.unlinkSync(tmp) } catch { /* ignore */ } })
    })
    return
  }
  // 改图/造图后端反代:把 /api/redraw、/api/create、/cert 透传给 FastAPI(8789)。
  // 让单端口 8788 也能用改图工坊(原本只有 vite 5173 才转发到 8789),无需再开 vite/https。
  if (/^\/(api\/redraw|api\/create|cert)(\/|$|\?)/.test(req.url || '')) {
    const up = http.request(
      { hostname: '127.0.0.1', port: 8789, method: req.method, path: req.url, headers: { ...req.headers, host: '127.0.0.1:8789' } },
      (ur) => { res.writeHead(ur.statusCode || 502, ur.headers); ur.pipe(res) },
    )
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: '改图后端(8789)未响应: ' + String(e.message || e) }))
    })
    req.pipe(up)
    return
  }
  // 静态托管已构建的前端(dist),让"发动机"自己把网页也端出来:
  // 打开 http://localhost:8788/ 就是完整工坊,API 同源,无需另开 dev 服务。
  if (req.method === 'GET' && !req.url?.startsWith('/v1/')) {
    const distDir = path.join(import.meta.dirname, '..', 'dist')
    if (fs.existsSync(distDir)) {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      let filePath = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath)
      // 防目录穿越 + SPA 回退:非静态资源路径一律回 index.html(支持 /prompt 前端路由)
      if (!filePath.startsWith(distDir)) filePath = path.join(distDir, 'index.html')
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html')
      }
      const ext = path.extname(filePath).toLowerCase()
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream'
      try {
        const buf = fs.readFileSync(filePath)
        res.writeHead(200, { 'Content-Type': mime })
        return res.end(buf)
      } catch { /* 落到 404 */ }
    }
  }
  // 知识库存储:把图文工坊产出的成品存成 .md 进 Obsidian 文件夹
  if (req.method === 'POST' && req.url === '/gbrain-save') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let payload
      try { payload = JSON.parse(body) } catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'bad json' })) }
      const { slug, content } = payload || {}
      if (!slug || !content) { res.writeHead(400); return res.end(JSON.stringify({ error: 'slug 和 content 不能为空' })) }
      try {
        fs.mkdirSync(KB_DIR, { recursive: true })
        // 防路径穿越:只取文件名成分
        const safe = path.basename(String(slug)).replace(/[/\\]/g, '_')
        const file = path.join(KB_DIR, safe + '.md')
        fs.writeFileSync(file, content, 'utf8')
        console.log(`[知识库] 已存入 Obsidian: ${safe}.md`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, slug: safe }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: '写入 Obsidian 失败: ' + (e.message || e) }))
      }
    })
    return
  }

  // 知识库读取:从 Obsidian 文件夹按文件名前缀把存过的成品全捞回来
  if (req.method === 'POST' && req.url === '/gbrain-list') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let payload
      try { payload = JSON.parse(body) } catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'bad json' })) }
      const prefixes = Array.isArray(payload?.prefixes) ? payload.prefixes : []
      if (!prefixes.length) { res.writeHead(400); return res.end(JSON.stringify({ error: 'prefixes 不能为空' })) }
      try {
        if (!fs.existsSync(KB_DIR)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ ok: true, items: [] }))
        }
        const items = fs.readdirSync(KB_DIR)
          .filter((f) => f.endsWith('.md') && prefixes.some((p) => f.startsWith(p)))
          .map((f) => ({ slug: f.replace(/\.md$/, ''), content: fs.readFileSync(path.join(KB_DIR, f), 'utf8').trim() }))
          .filter((it) => it.content)
        console.log(`[知识库] 从 Obsidian 捞回 ${items.length} 篇 (前缀: ${prefixes.join('/')})`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, items }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: '读取 Obsidian 失败: ' + (e.message || e) }))
      }
    })
    return
  }

  if (!(req.method === 'POST' && req.url?.startsWith('/v1/chat/completions'))) { res.writeHead(404); return res.end('not found') }

  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let payload
    try { payload = JSON.parse(body) } catch { res.writeHead(400); return res.end('bad json') }
    const model = payload.model || 'claude-sonnet-4-6'
    const prompt = buildPrompt(payload.messages)
    const wantStream = payload.stream !== false
    const id = 'chatcmpl-' + Math.random().toString(36).slice(2)
    const backend = pickBackend(model)
    const finalModel = backend === 'gemini' ? 'gemini-3.1-pro-preview' : model
    if (backend === 'gemini' && model !== finalModel) console.log(`[proxy] gemini 硬锁 model: ${model} -> ${finalModel}`)
    console.log(`[proxy] ${backend} <- model=${finalModel} (${prompt.length}字)`)
    if (backend === 'gemini') return runGemini(res, id, finalModel, prompt, wantStream)
    if (backend === 'codex') return runCodex(res, id, finalModel, prompt, wantStream)
    return runClaude(res, id, finalModel, prompt, wantStream)
  })
})

// 0.0.0.0:允许同一局域网(同 WiFi)的其它电脑/手机访问 这台Mac的IP:8788
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] 改文工坊已启动`)
  console.log(`[proxy] 本机打开:    http://localhost:${PORT}`)
  // 打印本机局域网 IP,方便另一台电脑访问
  try {
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) {
          console.log(`[proxy] 局域网打开:  http://${ni.address}:${PORT}  (同 WiFi 的其它设备用这个)`)
        }
      }
    }
  } catch { /* ignore */ }
  console.log(`[proxy] 后端分流: claude -p / codex exec / ${GEMINI_CMD} -p (都走订阅)`)
})
