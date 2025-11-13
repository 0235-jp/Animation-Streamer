# Animation Streamer – 詳細設計書

## 1. プロジェクト構成 (予定)
```
animation-streamer/
├─ src/
│  ├─ app.ts                 # Express起動, DI初期化
│  ├─ server.ts              # HTTPサーバーエントリポイント
│  ├─ config/
│  │   ├─ loader.ts          # JSON読込とバリデーション
│  │   └─ schema.ts          # zodスキーマ
│  ├─ api/
│  │   ├─ routes.ts          # Expressルート定義
│  │   └─ controllers/
│  │        ├─ stream.controller.ts
│  │        └─ generation.controller.ts
│  ├─ services/
│  │   ├─ stream.service.ts  # 状態管理・オーケストレーション
│  │   ├─ idle-loop.controller.ts
│  │   ├─ speech-queue.ts    # TODO: text処理用 FIFO
│  │   ├─ generation.service.ts # generate API用
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
  "server": { "port": 4000 },
  "rtmp": { "outputUrl": "rtmp://127.0.0.1:1935/live/main" },
  "actions": [
    { "id": "start", "path": "../example/motion/start.mp4" }
  ],
  "idleMotions": {
    "large": [
      { "id": "idle-default-large", "emotion": "neutral", "path": "../example/motion/idle.mp4" }
    ],
    "small": [
      { "id": "idle-default-small", "emotion": "neutral", "path": "../example/motion/talk_idle.mp4" }
    ]
  },
  "speechMotions": {
    "large": [
      { "id": "talk-default-large", "emotion": "neutral", "path": "../example/motion/talk_large.mp4" },
    ],
    "small": [
      { "id": "talk-default-small", "emotion": "neutral", "path": "../example/motion/talk_small.mp4" },
    ]
  },
  "speechTransitions": {
    "enter": [
      { "id": "enter-neutral", "emotion": "neutral", "path": "../example/motion/enter.mp4" },
      { "id": "enter-happy", "emotion": "happy", "path": "../example/motion/enter.mp4" }
    ],
    "exit": [
      { "id": "exit-neutral", "emotion": "neutral", "path": "../example/motion/exit.mp4" },
      { "id": "exit-happy", "emotion": "happy", "path": "../example/motion/exit.mp4" }
    ]
  },
  "audioProfile": {
    "ttsEngine": "voicevox",
    "voicevoxUrl": "http://127.0.0.1:50021",
    "speakerId": 1
  },
  "assets": { "tempDir": "./tmp" }
}
```
- `actions` は `action` に任意IDを指定するための単発モーション定義。`speak` / `idle` は予約語のため登録不可。サーバー側ではリクエストの `action` 値を小文字へ正規化して照合するため、`config.actions[].id` も全て小文字で記述しておくこと。
- `idleMotions` は待機モーションのプール。`speechMotions` は `large` / `small` ごとに配列を分け、感情ごとにモーションセットを切り替えられる。
- `speechTransitions` を設定すると、`speak` アクションの先頭に `enter`（例: idle→talk）、末尾に `exit`（例: talk→idle）を自動挿入する。遷移にも `emotion` を設定でき、`speechMotions` と同様に「一致したemotion → neutral → その他」の優先順位で選択される。
- `path` はffmpegが読めるローカルパス。
- `audioProfile` は唯一のTTS設定として VOICEVOX のURLやspeakerIdを含む。

## 3. 状態管理
- `interface StreamState { sessionId: string; phase: 'IDLE'|'WAITING'|'SPEECH'|'STOPPED'; activeMotionId?: string; queueLength: number; }
- `StreamSession` クラスが以下を保持:
  - `phase`
  - `idleLoopProcess: ChildProcess | null`
  - `speechProcess: ChildProcess | null`
  - `queue: SpeechTaskQueue`
  - `currentMotionId`
- ミューテックス (`AsyncLock`) を用い API からの `start`/`stop`/`text` 呼び出し間の競合を防ぐ。
- `status` API 用に読み取り専用スナップショットを提供。
- `GenerationService` はストリーム状態とは独立したジョブ（`generate` API呼び出し）を扱うため、`StreamSession` のロックとは切り離されている。現状は1リクエスト内のアクションを逐次処理し、API呼び出し単位で完結する（全体キュー／同時実行数制御は今後の拡張候補）。

## 4. IdleLoopController（待機・発話共通プレイリスト）
- 入力: `idleMotions: Motion[]`, `outputUrl`, `ProcessManager`。
- 実装戦略: ffmpegの`concat`デマルチプレクサを使い、待機モーションと発話モーションのプレイリストを標準入力から逐次供給する。ffmpegプロセスは常駐し、ループ・割込みとも同一ストリーム内で処理してフレームギャップを生まない。
  1. `start()` で `ffmpeg -re -f concat -safe 0 -i pipe:0 -c copy -f flv <output>` を起動し、`stdin`へ最初の待機モーションエントリ（`file '<path>'`）を書き込む。
  2. ffmpegは現在のモーション再生中に次エントリが届くとシームレスに続きの動画として扱う。`IdleLoopController`は動画終了見込み時間の少し前に次の待機モーションをランダム選択して`stdin`へ追記し、常に数件のバッファを確保する。
  3. `SpeechTaskQueue` から「次は発話モーションを再生したい」というリクエストを受けると、待機モーションの追記を一時的に停止し、次エントリとして発話モーションを挿入する。そのモーションが再生されている間にも、終了後に続く待機モーションを先行予約する。
  4. `stop()` はChildProcessへSIGTERM→timeout→SIGKILL。停止時は`stdin`を閉じて `concat` を自然終了させる。
- 待機モーションの末尾フレームと発話モーションの先頭フレームをデザイナー側で揃えておけば、プレイリスト挿入のみで「待機→発話→待機」が一切止まらず繋がる。

## 5. SpeechTaskQueue (将来実装)
- 役割: `text` エンドポイントから`SpeechTask`を受信順で管理。
- 2段階処理:
  - **prepare phase**: TTS実行や音声ファイル生成（並列OK、音声プロファイルに設定されたVOICEVOX URLを利用）。
  - **playback phase**: 再生は FIFO 順に1件ずつ。`IdleLoopController.reserveNextClip(taskClipPath)` を呼び、待機モーションの次エントリとして発話モーションを差し込み、再生後に待機モーション追記を再開する。
- 待機ループが`concat`入力を受け取っているため、`reserveNextClip` で待機プレイリストへの書き込みを調整し、現在再生中の待機モーション終了直後に発話モーションが始まるようスケジューリングする。発話モーション終了前に次の待機モーションを先行で書き込むことでフレーム欠落を避ける。
- 実装案: Node の `EventEmitter` と Promise チェーンで自前キュー、または `p-queue` 等の軽量ライブラリ。
- 現段階では`enqueue`にTODOを入れ、APIからの呼び出しを受けるだけ。

## 6. GenerationService（generateエンドポイント）
- 役割: `POST /api/generate` のアクション列を処理し、音声合成と動画合成を行って `assets.tempDir` にファイルを生成する。配信ストリームの状態とは独立して実行される。

### 6.1 リクエストボディ
```jsonc
{
  "stream": true,
  "defaults": {
    "emotion": "neutral",
    "idleMotionId": "idle-default-large"
  },
  "requests": [
    {
      "action": "speak",
      "params": {
        "text": "こんにちは",
        "emotion": "happy",
        "tags": ["intro"]
      }
    },
    {
      "action": "idle",
      "params": {
        "durationMs": 1000,
        "motionId": "idle-default-large"
      }
    },
    {
      "action": "start"
    }
  ],
  "metadata": {
    "sessionId": "abc123"
  }
}
```
- `stream`: `true` の場合は逐次レスポンス（chunked JSON / SSE）で生成完了ごとに結果をpush。`false`または未指定時は全アクション完了後にまとめて返す。
- `defaults`: バッチ内の共通既定値。`requests[].params` に同名キーがあればそちらを優先。
- `requests` は記述順に処理され、レスポンスの `id` はサーバー側で `1, 2, ...` と自動採番される（クライアント指定は不要）。
- `requests[].action`: `speak` / `idle` / 設定ファイルで定義した `actions[].id` のいずれか。`speak` と `idle` は予約語のため `actions` には登録不可。
- `requests[].params`: アクション固有の入力。将来タグ経由で話速・ポーズを制御できるよう `tags: string[]` を受け付けておく。

### 6.2 アクション種別
- **speak**
  - 必須: `text`。`emotion` は任意（未指定時は `defaults.emotion` → `neutral`）。emotion指定があっても該当モーションが無い場合は `neutral` プールへフォールバックする。
  - VOICEVOX で音声合成 → `MediaPipeline.normalizeAudio` で 48kHz ステレオ化 → `MediaPipeline.trimAudioSilence` で前後の無音を除去し、実際の発話部分だけを残す。この「トリミング済み音声」の尺を計測して発話モーションを割り当てる。`speechTransitions.enter/exit` が定義されている場合は、トリミング済み音声の前後にサイレントパディングを付与して `idle→talk` / `talk→idle` のブリッジ動画と同期させる。
  - `speechMotions` を emotion + type(Large/Small)でグループ化し、`animation-streamer-example` の `buildTimelinePlan` と同様に Largeで埋めて余りをSmallで補完。emotionに一致するモーションが無ければ `neutral` → その他任意順でフォールバック。
- **idle**
  - 必須: `durationMs`。任意: `motionId`（明示指定時はそのモーションだけで構成）、`emotion`（待機モーションの感情タグでフィルタ）。
  - 音声は生成せず、`idleMotions` をLarge優先/Small補完で `durationMs` をカバーする。必要に応じて `anullsrc` で無音AACを生成し動画長に合わせる。
- **任意アクション（config.actions）**
  - `action` フィールドの値は `config.actions[].id`（小文字）と一致している必要がある。事前登録された動画1本を合成して出力し、動画に音声トラックが含まれていれば抽出して長さ調整のうえ再利用する。音声が存在しない場合のみ `anullsrc` を生成して多重化する。

### 6.3 処理フロー
1. `GenerationService` がリクエスト全体をバリデート。`requests` が空なら400。
2. `requests` を順次処理。各アクションは `GenerationJobContext` に共有リソース（設定・tempDir・VOICEVOXクライアント）を持つ。
3. `speak`:
   1. `VoicevoxClient.synthesize(text)` でWAV生成。
   2. `MediaPipeline.normalizeAudio` で 48kHz / stereo に揃えたあと、`MediaPipeline.trimAudioSilence` で前後無音を削除。トリミング済み音声を発話本体として保持し、このファイルの長さを `ClipPlanner` の入力に使う。
   3. `ClipPlanner.selectSpeechClips(emotion, duration)` がモーションリストを返す。`speechTransitions.enter/exit` が設定されていれば、リストの先頭にidle→talk、末尾にtalk→idleのトランジションを差し込み、音声側は前後にサイレントパディングを入れて同期させる。
   4. `MediaPipeline.compose(clips, audioPath, duration)` が concat用リストを作り、ffmpegで MP4 を出力（音声はトリミング済み＋パディング済みのものを利用）。
4. `idle`: `ClipPlanner.selectIdleClips(duration, emotion)` → `MediaPipeline.compose(clips, null, duration)`。
5. 任意アクション: `actions` から動画パスを取得し単体で `compose`。
6. `stream === true` の場合はアクション単位で即座にffmpegを走らせ、生成順にNDJSONで返却する。
7. `stream === false` の場合は、すべてのアクション音声とモーションを一つのタイムラインに並べ、1回のffmpeg実行で最終MP4を生成する（レスポンスは `outputPath` / `durationMs` などのメタ情報を直列で返す）。
8. 失敗時はその地点で処理を停止し、レスポンスに失敗IDとエラー内容を含める。

### 6.4 レスポンス
- `stream: false`（デフォルト）
  ```json
  {
    "outputPath": ".../tmp/batch-123.mp4",
    "durationMs": 3450,
    "motionIds": ["..."] // debug=true のときのみ
  }
  ```
  - `stream=false` 時は VOICEVOX やサイレント音声を含む各アクションをタイムライン上に並べ、1回の `ffmpeg` 実行で最終MP4を生成する。レスポンスは最終ファイルのメタ情報のみを返す（`combined` オブジェクトは用意しない）。
- `stream: true`
  - `Content-Type: application/x-ndjson`（予定）。各ジョブ完了で `{"type":"result","result":{...}}` を1行出力し、最後に `{"type":"done","count":3}` を送出。
  - エラー時は `{"type":"error","id":"2","message":"..."}`

## 7. MediaPipeline / ClipPlanner
- **ClipPlanner**
  - `selectSpeechClips(emotion, duration)` と `selectIdleClips(duration)` を提供。`animation-streamer-example/src/lib/timeline.ts` の Large/Small選択ロジックをサーバーサイドへ移植し、durationをカバーするまでランダムにLargeを優先・余剰をSmallで補完する。
  - emotionごとのプールを事前に構築し、ヒットしない場合は `neutral` → `その他` の順でフォールバック。
- **MediaPipeline**
  - VOICEVOX呼び出しは `VoicevoxClient` が担い、`MediaPipeline` は受け取ったWAVを正規化・加工する役割に専念する。
  - `normalizeAudio(input)`：48kHz / stereo / `pcm_s16le` へ変換し、以降の処理を同一フォーマットに統一。
  - `trimAudioSilence(input, {levelDb})`：`silenceremove → areverse → silenceremove → areverse` の2段構成で、先頭・末尾の無音を独立して削除する。デフォルトでは -70dB 未満を無音とみなし、発話中のポーズは残る。戻り値はトリミング済みファイルパス。
  - `compose(clips, audioPath | null, durationMs)`：`clips` から `concat` ファイルを生成し、必要数だけ `ffmpeg -stream_loop` or 事前コピーで並べる。映像は `-c:v copy` で元素材のエンコード/解像度を維持し、音声が無い場合は `anullsrc` を入力に追加してAACトラックを生成。音声がある場合は、トリミング済み音声（＋必要なサイレントパディング）を入力に使う。
  - 合成ファイルはジョブディレクトリ内に MP4 で書き出し、`GenerationService` が `assets.tempDir` へ移動してクライアントへ絶対パスを返す。映像コーデックは素材準拠（`copy`）で、音声のみAACへ揃える。
  - 生成中の一時ファイルは `CleanupService` に登録しておき、成功/失敗に関わらず削除。
- ストリーム配信用の `createIdleProcess` / `createSpeechProcess` も将来ここにまとめるが、現段階では `generate` 用 `compose` が中心。
- ffmpeg呼び出しは `fluent-ffmpeg` か `child_process.spawn` のどちらでもよいが、`-f concat -safe 0 -i <list>` + `-i <audio>` + `-c:v copy -c:a aac -shortest` を基本形とする。

## 8. API 仕様 (初期)
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

### POST /api/generate
- Body（例）: セクション6.1参照。
- `stream: false`（デフォルト）の場合は `200 OK` + `{ "outputPath": "...", "durationMs": 1234, ... }`。
- `stream: true` の場合は `200 OK` + `Content-Type: application/x-ndjson`。1アクション完了ごとに
  ```
  {"type":"result","result":{"id":"1","action":"speak","outputPath":"/abs/tmp/clip-1.mp4","durationMs":2450}}
  ```
  を書き出し、最後に `{"type":"done","count":3}`。エラー時は `{"type":"error","id":"2","message":"..."}`
- 再生ストリームとは独立して呼び出せるため、`start/stop` 状態に依存しない。

### GET /api/status
- 例: `{ "status": "WAITING", "currentMotionId": "idle-think", "queueLength": 0, "uptimeMs": 12345 }

## 9. エラーハンドリング・クリーンアップ
- ffmpegプロセスは `exit` コードを監視し、異常終了時はログ出力後に次モーションで再試行。
- stop時:
  - `idleLoopProcess`/`speechProcess` にSIGTERM。
  - 5秒以内に終了しなければSIGKILL。
  - `tmp` ディレクトリの一時ファイルを削除。
- APIエラーコード:
  - 400: 入力バリデーション不備。
  - 409: 状態的に矛盾する操作 (例: stop中にstart)。
  - 500: 予期しないエラー。ログID付きで返却。

## 10. ログ & メトリクス
- PinoでJSONログを出力。主要イベント: API呼び出し、状態遷移、ffmpeg開始/終了、エラー。
- 後日、OBSの監視用途にPrometheusエンドポイントを追加可能。

## 11. 未実装項目 / TODO
- `text` / `generate` エンドポイント内部のTTS呼び出し、音声合成、ストリーム割込み／MP4出力処理。
- 音声/動画素材の正当性チェック、自動ダウンロード機構。
- 簡易認証(APIキー)とTLS化。
- 単体テスト・結合テスト。
