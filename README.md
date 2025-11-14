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
    "debug": true,
    "characterId": "anchor-a",
    "requests": [
      { "action": "start" },
      { "action": "speak", "params": { "text": "こんにちは", "emotion": "happy" } },
      { "action": "idle", "params": { "durationMs": 2000 } },
      { "action": "speak", "params": { "text": "さようなら" } }
    ]
  }'
```

`stream=false` の場合は `combined.outputPath` に 1 本にまとめたMP4パスが返却されます。 `stream=true` を指定すると各アクション完了ごとに NDJSON でレスポンスがストリーミングされます。  
`characterId` はリクエスト直下で **必須** 指定です（すべてのアクションが同一キャラクターを参照します）。  
`server.apiKey` を設定した場合は `-H 'X-API-Key: <your-key>'` を付与してください。


## 設定
`config/stream-profile.json` でモーション動画や VOICEVOX エンドポイントなどを定義します。主な項目は以下の通りです。

- server.port / server.host / server.apiKey: API の待受ポート・ホスト・APIキー。
- characters: キャラクターごとの設定配列。最低1件登録し、APIからは `characterId` で参照します。
  - id / displayName: キャラクター識別子と任意の表示名。
  - actions: キャラクター固有のカスタムアクション群（`speak`/`idle` は予約語のため不可）。`id` は `requests[].action` に指定し、`path` は再生する動画パスです。
  - idleMotions / speechMotions: 待機・発話モーションのプール。`large`/`small` と emotion ごとに最適なクリップを選択し、`motionId` で直接指定もできます。
  - speechTransitions (任意): `speak` の前後に自動で差し込む導入/締めモーション。emotion が一致しない場合は `neutral` → その他の順でフォールバックします。
  - audioProfile: キャラクター単位の VOICEVOX 接続設定。`voicevoxUrl` や話者 ID、emotion 別の `voices[]` を定義できます。
- assets.tempDir: 生成処理中の一時的な音声・動画を配置するディレクトリで、起動時に自動作成されます。

`config/example.stream-profile.json` には Anchor A/B の 2 キャラクター例が含まれているので、必要に応じて `characters[]` を増やし、`characterId` を切り替えて利用してください。
