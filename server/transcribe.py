#!/usr/bin/env python3
# 用 mlx-whisper 把音/视频文件转成中文逐字稿。
# 用法: .venv-whisper/bin/python transcribe.py <媒体文件路径>
# 只往 stdout 打转写文本;进度/日志走 stderr。
import sys

def main():
    if len(sys.argv) < 2:
        print("usage: transcribe.py <file>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    # turbo:比 large-v3 快 5-8 倍,中文够用,配 Claude 纠错兜底。要极致准确改回 large-v3-mlx
    model = sys.argv[2] if len(sys.argv) > 2 else "mlx-community/whisper-large-v3-turbo"
    import mlx_whisper
    r = mlx_whisper.transcribe(path, path_or_hf_repo=model, language="zh")
    sys.stdout.write((r.get("text") or "").strip())

if __name__ == "__main__":
    main()
