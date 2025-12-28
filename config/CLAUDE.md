# config/

アプリケーション設定ファイルを格納するディレクトリ。

## ファイル構成

- `stream-profile.json` - メイン設定ファイル（git管理外）
- `example.stream-profile.local.json` - ローカル開発用テンプレート
- `example.stream-profile.docker.json` - Docker用テンプレート
- `example.stream-profile.sbv2.json` - Style-Bert-VITS2用テンプレート

## 設定構造

```json
{
  "server": {
    "port": 4000,
    "host": "0.0.0.0",
    "apiKey": "任意のAPIキー"
  },
  "rtmp": {
    "outputUrl": "rtmp://127.0.0.1:1936/live/main"
  },
  "stt": {
    "baseUrl": "http://localhost:8000/v1",
    "model": "whisper-1",
    "language": "ja"
  },
  "presets": [...]
}
```

## プリセット設定

各プリセットは以下を定義:
- `id` / `displayName` - 識別子と表示名
- `actions` - カスタムアクション
- `idleMotions` - 待機モーション (large/small)
- `speechMotions` - 発話モーション (large/small) ※speakアクション用
- `speechTransitions` - 発話開始/終了トランジション
- `audioProfile` - TTS設定 (voicevox または style-bert-vits2)
- `lipSync` - リップシンク設定 (speakLipSync アクション用、large/small 形式)

**注意**: `speechMotions` または `lipSync` のどちらかは必須

## セットアップ

```bash
# ローカル開発
cp config/example.stream-profile.local.json config/stream-profile.json

# Docker
cp config/example.stream-profile.docker.json config/stream-profile.json
```
