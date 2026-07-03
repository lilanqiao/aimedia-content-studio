import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Studio from '@/pages/Studio'
import PromptStudio from '@/pages/PromptStudio'
import ImagePage from '@/pages/Image'
import History from '@/pages/History'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 提炼文案风格 / 提炼画面风格:同组件按 ptype 区分,key 不同各自独立挂载、各存各的 */}
        <Route path="/" element={<PromptStudio key="copy" ptype="copy" />} />
        <Route path="/style-visual" element={<PromptStudio key="visual" ptype="visual" />} />
        {/* 用风格原创文(给主题原创) 与 用风格改文 共用 Studio,靠 mode 区分;key 不同 → 各自重挂、各记各的内容 */}
        <Route path="/write" element={<Studio key="original" mode="original" />} />
        <Route path="/rewrite" element={<Studio key="rewrite" mode="rewrite" />} />
        {/* 配图:文案 + 画面风格 → 图(中转站自动出图 / 订阅给提示词手动出) */}
        <Route path="/image" element={<ImagePage />} />
        <Route path="/history" element={<History />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
