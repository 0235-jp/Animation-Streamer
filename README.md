# Animation Streamer

音声合成(TTS)とモーション動画を組み合わせ、待機状態から発話→待機へシームレスに繋がるクリップを生成するためのローカルAPIサーバーです。

## 必要環境
- Node.js 20 以上
- ffmpeg / ffprobe
- VOICEVOX エンジン (ローカルAPI)

## セットアップ
```bash
cp config/example.stream-profile.json config/stream-profile.json
npm install
```

## 開発サーバー
```bash
npm run dev
```

`http://localhost:4000/docs` で Swagger UI を確認できます。

## API 例
```bash
curl -X POST http://localhost:4000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "stream": false,
    "requests": [
      { "action": "speak", "params": { "text": "こんにちは" } },
      { "action": "idle", "params": { "durationMs": 2000 } },
      { "action": "speak", "params": { "text": "さようなら" } }
    ]
  }'
```

`stream=false` の場合は `combined.outputPath` に 1 本にまとめたMP4パスが返却されます。 `stream=true` を指定すると各アクション完了ごとに NDJSON でレスポンスがストリーミングされます。

## 設定
- `config/stream-profile.json` でモーション動画、VOICEVOXエンドポイント、RTMP出力などを定義します。主な拡張ポイントは以下の通り。
  - `speechTransitions.enter` / `exit` を設定すると、`speak` アクションの先頭/末尾に idle→talk / talk→idle のブリッジ動画が自動挿入され、音声にも同じ長さのサイレントパディングが付与されます。
  - `actions` に任意IDと動画パスを追加すれば、`action` フィールドでそのIDを指定してプレセット動画を再生できます（`speak` / `idle` は予約語のため登録不可）。
  - `speechMotions.large` / `.small` で発話モーションを感情別に管理できます。Large/Smallタイプは `animation-streamer-example` のタイムラインロジックを踏襲しています。

## Swagger サンプル
OpenAPI は `docs/openapi.yaml` に定義されています。Swagger UI からテンプレートを再利用できます。例:
```json
{
  "stream": false,
  "defaults": { "emotion": "neutral" },
  "requests": [
    { "action": "speak", "params": { "text": "こんにちは", "emotion": "happy" } },
    { "action": "idle", "params": { "durationMs": 2000 } },
    { "action": "start" }
  ]
}
```

## カスタマイズのヒント
- `speechTransitions` や `speechMotions` を差し替えることで、キャラクター固有の発話モーションに合わせたタイムラインを構築できます。
- `actions` へ任意の動画を追加すれば、`start` などのイベントモーションをAPI経由で再生できます。
