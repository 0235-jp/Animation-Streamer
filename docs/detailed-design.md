# AI Animation Streamer – 詳細設計書

## 1. プロジェクト構成 (予定)
```
ai-animation-streamer/
├─ src/
│  ├─ app.ts                 # Express起動, DI初期化
│  ├─ server.ts              # HTTPサーバーエントリポイント
│  ├─ config/
│  │   ├─ loader.ts          # JSON読込とバリデーション
│  │   └─ schema.ts          # zodスキーマ
│  ├─ api/
│  │   ├─ routes.ts          # Expressルート定義
│  │   └─ controllers/
│  │        └─ stream.controller.ts
│  ├─ services/
│  │   ├─ stream.service.ts  # 状態管理・オーケストレーション
│  │   ├─ waiting-loop.controller.ts
│  │   ├─ speech-queue.ts    # TODO: text処理用 FIFO
│  │   ├─ media-pipeline.ts  # ffmpeg/TTS連携
│  │   └─ cleanup.service.ts
│  ├─ infra/
│  │   ├─ media-server.ts    # node-media-server ラッパー
│  │   └─ process-manager.ts # ChildProcess生成共通化
│  └─ types/
│      └─ stream.ts          # 状態/設定の共通型
├─ config/
│  └─ stream-profile.json    # 設定ファイル（RTMP出力URL、待機モーション、単一音声プロファイル）
├─ docs/
│  ├─ overview.md
│  └─ detailed-design.md
├─ test/ (後日)
├─ package.json
└─ tsconfig.json
```

## 2. 設定ファイル `config/stream-profile.json`
- 起動時にのみ読み込み、稼働中は変更を反映しない。
- アプリは1キャラクター前提のため音声プロファイルは1件のみ定義する。
- サンプル:
```json
{
  "server": {
    "port": 4000
  },
  "rtmp": {
    "outputUrl": "rtmp://localhost:1935/live/main"
  },
  "waitingMotions": [
    {"id": "idle-wave", "path": "assets/waiting/wave.mp4"},
    {"id": "idle-think", "path": "assets/waiting/think.mp4"}
  ],
  "speechMotions": [
    {"id": "talk-default", "path": "assets/speech/default.mp4"}
  ],
  "audioProfile": {
    "ttsEngine": "voicevox",
    "voicevoxUrl": "http://127.0.0.1:50021",
    "speakerId": 1
  },
  "assets": {
    "tempDir": "./tmp"
  }
}
```
- `waitingMotions` は1件以上必須。`path` はffmpegが読めるローカルパス。
- `server.port` でAPIサーバーのListenポートを指定。環境変数`PORT`があれば優先される。
- `waitingMotions` は1件以上必須。`path` はffmpegが読めるローカルパス。
- `audioProfile` は唯一のTTS設定として `text` 実装時に使用し、VOICEVOX のURLやspeakerIdを含む。現段階では存在だけ定義。

## 3. 状態管理
- `interface StreamState { sessionId: string; phase: 'IDLE'|'WAITING'|'SPEECH'|'STOPPED'; activeMotionId?: string; queueLength: number; }
- `StreamSession` クラスが以下を保持:
  - `phase`
  - `waitingProcess: ChildProcess | null`
  - `speechProcess: ChildProcess | null`
  - `queue: SpeechTaskQueue`
  - `currentMotionId`
- ミューテックス (`AsyncLock`) を用い API からの `start`/`stop`/`text` 呼び出し間の競合を防ぐ。
- `status` API 用に読み取り専用スナップショットを提供。

## 4. WaitingLoopController（待機・発話共通プレイリスト）
- 入力: `waitingMotions: Motion[]`, `outputUrl`, `ProcessManager`。
- 実装戦略: ffmpegの`concat`デマルチプレクサを使い、待機モーションと発話モーションのプレイリストを標準入力から逐次供給する。ffmpegプロセスは常駐し、ループ・割込みとも同一ストリーム内で処理してフレームギャップを生まない。
  1. `start()` で `ffmpeg -re -f concat -safe 0 -i pipe:0 -c copy -f flv <output>` を起動し、`stdin`へ最初の待機モーションエントリ（`file '<path>'`）を書き込む。
  2. ffmpegは現在のモーション再生中に次エントリが届くとシームレスに続きの動画として扱う。`WaitingLoopController`は動画終了見込み時間の少し前に次の待機モーションをランダム選択して`stdin`へ追記し、常に数件のバッファを確保する。
  3. `SpeechTaskQueue` から「次は発話モーションを再生したい」というリクエストを受けると、待機モーションの追記を一時的に停止し、次エントリとして発話モーションを挿入する。そのモーションが再生されている間にも、終了後に続く待機モーションを先行予約する。
  4. `stop()` はChildProcessへSIGTERM→timeout→SIGKILL。停止時は`stdin`を閉じて `concat` を自然終了させる。
- 待機モーションの末尾フレームと発話モーションの先頭フレームをデザイナー側で揃えておけば、プレイリスト挿入のみで「待機→発話→待機」が一切止まらず繋がる。

## 5. SpeechTaskQueue (将来実装)
- 役割: `text` エンドポイントから`SpeechTask`を受信順で管理。
- 2段階処理:
  - **prepare phase**: TTS実行や音声ファイル生成（並列OK、音声プロファイルに設定されたVOICEVOX URLを利用）。
  - **playback phase**: 再生は FIFO 順に1件ずつ。`WaitingLoopController.reserveNextClip(taskClipPath)` を呼び、待機モーションの次エントリとして発話モーションを差し込み、再生後に待機モーション追記を再開する。
- 待機ループが`concat`入力を受け取っているため、`reserveNextClip` で待機プレイリストへの書き込みを調整し、現在再生中の待機モーション終了直後に発話モーションが始まるようスケジューリングする。発話モーション終了前に次の待機モーションを先行で書き込むことでフレーム欠落を避ける。
- 実装案: Node の `EventEmitter` と Promise チェーンで自前キュー、または `p-queue` 等の軽量ライブラリ。
- 現段階では`enqueue`にTODOを入れ、APIからの呼び出しを受けるだけ。

## 6. MediaPipeline
- `createWaitingProcess(motionPath)` / `createSpeechProcess(videoPath, audioPath)` を提供。
- ffmpegコマンド例（待機）:
  ```
  ffmpeg -hide_banner -loglevel error -re -stream_loop 0 -i <motion> \
         -c copy -f flv rtmp://localhost:1935/live/main
  ```
- 発話（将来）:
  ```
  ffmpeg -hide_banner -loglevel error -re -i <speechVideo> -i <ttsAudio.wav> \
         -shortest -c:v copy -c:a aac -f flv rtmp://localhost:1935/live/main
  ```
- `ProcessManager` が ChildProcess の生成・ログ・SIGTERM を一括管理。
- 発話モーション素材は待機モーション末端と接続する前提で作成されるため、`MediaPipeline` は追加のクロスフェード処理を行わずにそのまま `concat` プレイリストへ登録する。必要に応じて将来的に1フレーム分のブレンドを入れられる拡張ポイントを残す。

## 7. API 仕様 (初期)
### POST /api/start
- Body: `{ "sessionToken": "optional" }` (後日認証導入予定)。
- 成功 200: `{ "status": "WAITING", "sessionId": "...", "currentMotionId": "idle-wave" }`
- 既に待機中なら同レスポンス。

### POST /api/stop
- Body: `{}`
- 成功 200: `{ "status": "STOPPED" }`
- 実行中タスクがあればキャンセル。

### POST /api/text (TODO)
- Body案:
```json
{
  "text": "こんにちは",
  "motionId": "talk-default",
  "metadata": {}
}
```
- 現段階は `501 Not Implemented` を返し、内部キュー処理はまだ行わない。

### GET /api/status
- 例: `{ "status": "WAITING", "currentMotionId": "idle-think", "queueLength": 0, "uptimeMs": 12345 }

## 8. エラーハンドリング・クリーンアップ
- ffmpegプロセスは `exit` コードを監視し、異常終了時はログ出力後に次モーションで再試行。
- stop時:
  - `waitingProcess`/`speechProcess` にSIGTERM。
  - 5秒以内に終了しなければSIGKILL。
  - `tmp` ディレクトリの一時ファイルを削除。
- APIエラーコード:
  - 400: 入力バリデーション不備。
  - 409: 状態的に矛盾する操作 (例: stop中にstart)。
  - 500: 予期しないエラー。ログID付きで返却。

## 9. ログ & メトリクス
- PinoでJSONログを出力。主要イベント: API呼び出し、状態遷移、ffmpeg開始/終了、エラー。
- 後日、OBSの監視用途にPrometheusエンドポイントを追加可能。

## 10. 未実装項目 / TODO
- `text` エンドポイント内部のTTS呼び出し、音声合成、発話再生。
- 音声/動画素材の正当性チェック、自動ダウンロード機構。
- 簡易認証(APIキー)とTLS化。
- 単体テスト・結合テスト。
