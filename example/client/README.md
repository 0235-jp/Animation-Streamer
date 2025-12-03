# ai-streamer クライアントサンプル

配信サイトのコメントを取得し、LLMで応答を生成して ai-streamer API に送信するサンプルクライアントです。

## 前提条件

- Node.js 20+
- [わんコメ](https://onecomme.com/) が起動していること
- ai-streamer が起動していること
- OpenAI API キー

## セットアップ

```bash
# 依存関係のインストール
npm install

# 設定ファイルの作成
cp config.example.json config.json
```

## 設定

`config.json` を編集してください:

```json
{
  "llm": {
    "apiKey": "sk-...",
    "model": "gpt-4o-mini",
    "systemPrompt": "あなたは配信者のAIアシスタントです。..."
  },
  "streamer": {
    "baseUrl": "http://localhost:4000",
    "presetId": "anchor-a"
  }
}
```

## 実行

```bash
# 開発モード
npm run dev

# または
npm run build
npm start
```

## 動作の流れ

1. 起動時に ai-streamer の `/api/stream/start` を呼び出してストリーム開始
2. わんコメに WebSocket 接続してコメントを待ち受け
3. コメント受信時に LLM で応答を生成（JSON形式）
4. 生成した応答を `/api/stream/text` で ai-streamer に送信
5. Ctrl+C で終了時に `/api/stream/stop` を呼び出して停止
