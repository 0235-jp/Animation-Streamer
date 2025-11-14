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
    "requests": [
      { "action": "start"} ,
      { "action": "speak", "params": { "text": "こんにちは", "emotion": "happy" } },
      { "action": "idle", "params": { "durationMs": 2000 } },
      { "action": "speak", "params": { "text": "さようなら" } }
    ]
  }'
```

`stream=false` の場合は `combined.outputPath` に 1 本にまとめたMP4パスが返却されます。 `stream=true` を指定すると各アクション完了ごとに NDJSON でレスポンスがストリーミングされます。

## 設定
`config/stream-profile.json` でモーション動画やVOICEVOXエンドポイントなどを定義します。詳細は以下の通り。

- server.port: HTTP API/Swagger UI が待ち受けるポート番号で、ローカル開発時は 4000 を想定しています。
- actions: `generate` API の `action` リクエストで再生できる単発モーション群で、`speak`/`idle` は予約語のため使用できません。
  - id: API から参照する識別子で、`requests[].action` に指定します。
  - path: 再生する動画の相対/絶対パスで、ffmpeg がアクセスできるローカルファイルを指します。
- idleMotions: 待機中にループ再生されるモーションプールで、感情(`emotion`)とサイズ(`large`/`small`)でフィルタされます。
  - large: 長尺かつ動きの大きい待機モーションを登録し、プランニング時に優先的に使用されます。
  - small: 大きさ・長さが足りない部分を埋める短尺待機モーションのプールです。
  - id: 待機モーション個別の識別子で、APIパラメータから直接指定して再生させることもできます。
  - emotion: `neutral` などの感情タグで、`requests[].params.emotion` と一致するモーションが優先されます。
  - path: 各モーション動画のパスで、`actions` と同じく ffmpeg が読める場所を指定します。
- speechMotions: 発話中に利用するモーションプールで、`large`/`small` と感情ごとに最適な映像を切り替えます。
  - large: メインとなる発話モーション群で、要求時間をこのプールで可能な限り埋めます。
  - small: 残り時間の微調整に使う短尺モーション群で、`large` が不足した場合のフォールバックにもなります。
  - id: 発話モーションの識別子で、ログやデバッグに利用されます。
  - emotion: 発話リクエストの `emotion` と一致した場合に優先採用され、未指定時は `neutral` が使われます。
  - path: 発話モーション動画のパスで、`idleMotions` と同様にローカルファイルを指定します。
- speechTransitions: `speak` アクションの前後に差し込む遷移モーションで、各 `emotion` ごとに複数の候補を登録できます。`speechMotions` と同様に「一致 → neutral → その他」の順で選択されます。
  - enter: 待機→発話へ切り替える導入モーションの配列です。
  - exit: 発話→待機に戻す締めモーションの配列です。
- audioProfile: TTS 用の接続情報をまとめたプロファイルで、現在は VOICEVOX のみサポートします。
  - ttsEngine: 使用する音声合成エンジン名で、`voicevox` 固定です。
  - voicevoxUrl: ローカルの VOICEVOX エンジン API エンドポイント URL です。
  - speakerId: VOICEVOX の話者 ID で、キャラクターの声色を切り替えられます。
  - speedScale (任意): 話速の倍率。省略すると VOICEVOX デフォルト (約 1.0) が使われます。
  - pitchScale (任意): ピッチのオフセット値。省略時はエンジン標準 (0.0)。
  - intonationScale (任意): 抑揚の強弱を決める倍率。省略時は標準値 (1.0)。
  - volumeScale (任意): 出力音量の倍率。省略時は標準 (1.0)。
  - outputSamplingRate (任意): サンプリングレート (Hz)。省略時は 24000。
  - outputStereo (任意): true でステレオ。省略時/false でモノラル。
- assets.tempDir: 生成処理中の一時的な音声・動画を配置するディレクトリで、起動時に自動作成されます。
