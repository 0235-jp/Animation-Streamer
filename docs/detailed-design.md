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
- キャラクターごとにモーションと音声プロファイルを定義し、リクエストで `presetId` を指定して利用する。どのキャラクターを使うかは API 呼び出し側で必ず明示する。
- サンプル:
```json
{
  "server": {
    "port": 4000,
    "host": "localhost",
    "apiKey": "optional-api-key"
  },
  "rtmp": { "outputUrl": "rtmp://127.0.0.1:1935/live/main" },
  "presets": [
    {
      "id": "anchor-a",
      "displayName": "Anchor A",
      "actions": [
        { "id": "start", "path": "start.mp4" }
      ],
      "idleMotions": {
        "large": [
          { "id": "idle-a-large", "emotion": "neutral", "path": "idle.mp4" }
        ],
        "small": [
          { "id": "idle-a-small", "emotion": "neutral", "path": "talk_idle.mp4" }
        ]
      },
      "speechMotions": {
        "large": [
          { "id": "talk-a-large", "emotion": "neutral", "path": "talk_large.mp4" },
          { "id": "talk-a-happy-large", "emotion": "happy", "path": "talk_large.mp4" }
        ],
        "small": [
          { "id": "talk-a-small", "emotion": "neutral", "path": "talk_small.mp4" }
        ]
      },
      "speechTransitions": {
        "enter": [
          { "id": "a-enter-neutral", "emotion": "neutral", "path": "enter.mp4" }
        ],
        "exit": [
          { "id": "a-exit-neutral", "emotion": "neutral", "path": "exit.mp4" }
        ]
      },
      "audioProfile": {
        "ttsEngine": "voicevox",
        "voicevoxUrl": "http://127.0.0.1:50021",
        "speakerId": 1,
        "voices": [
          { "emotion": "neutral", "speakerId": 1, "speedScale": 1.1 },
          { "emotion": "happy", "speakerId": 3, "pitchScale": 0.3 }
        ]
      }
    },
    {
      "id": "anchor-b",
      "displayName": "Anchor B",
      "actions": [
        { "id": "bow", "path": "bow.mp4" }
      ],
      "idleMotions": {
        "large": [
          { "id": "idle-b-large", "emotion": "neutral", "path": "idle.mp4" }
        ],
        "small": [
          { "id": "idle-b-small", "emotion": "neutral", "path": "talk_idle.mp4" }
        ]
      },
      "speechMotions": {
        "large": [
          { "id": "talk-b-large", "emotion": "neutral", "path": "talk_large.mp4" }
        ],
        "small": [
          { "id": "talk-b-small", "emotion": "neutral", "path": "talk_small.mp4" }
        ]
      },
      "audioProfile": {
        "ttsEngine": "voicevox",
        "voicevoxUrl": "http://127.0.0.1:50021",
        "speakerId": 8
      }
    }
  ]
}
```
- `server.host` は API がバインドするアドレスで、デフォルトは `localhost`。LAN 越しに公開する場合は `0.0.0.0` へ設定できる。
- `server.apiKey` を設定すると `/api/*` エンドポイントで `X-API-Key` ヘッダー照合を行い、未設定の場合は認証なしで利用できる。ヘッダー値は平文で比較し、マッチしない場合は 401 を返す。
- API リクエストではトップレベルの `presetId` で使用キャラクターを指定し、同一バッチ内のすべてのアクションがそのキャラクターを参照する（未指定時は400）。
- `presets` には1件以上を登録し、`displayName` はUIやログに表示するための任意フィールド。
- `presets[].actions` はキャラクター固有の単発モーション定義。`speak` / `idle` は予約語のため登録不可で、IDは小文字推奨。
- `presets[].idleMotions` は待機モーションのプール。`speechMotions` は `large` / `small` ごとに配列を分け、感情ごとにモーションセットを切り替えられる。
- `presets[].speechTransitions` を設定すると、`speak` アクションの先頭に `enter`（例: idle→talk）、末尾に `exit`（例: talk→idle）をキャラクター単位で自動挿入する。遷移にも `emotion` を設定でき、`speechMotions` と同様に「一致したemotion → neutral → その他」の優先順位で選択される。
- 各モーション `path` は ffmpeg が読めるローカルパス。プロジェクト直下に固定された `motions/` からの相対パス（例: `talk_idle.mp4` や `aaaa/talk_idle.mp4`）のみを記述し、実行環境では `./motions:/app/motions:ro` をボリュームマウントして同じパス構成を再現する。
- `presets[].audioProfile` はキャラクターに紐づくTTS設定として VOICEVOX のURLやspeakerIdに加え、`speedScale`/`pitchScale`/`intonationScale`/`volumeScale` や `outputSamplingRate`・`outputStereo` などの合成パラメータを任意で含む。`voices` 配列を指定すると、感情（`emotion`）ごとに話者 ID や調整値を切り替えられ、モーション選択と同じ優先順位で `requests[].params.emotion` に応じた TTS プロファイルが選択される。設定ファイルではトップレベルの `speakerId` と各種パラメータのみを指定すれば良く、`loader.ts` 側で自動的に `defaultVoice` に正規化されるため、`defaultVoice` プロパティを明示的に記述する必要はない。
- 生成済み MP4・WAV は設定とは独立したプロジェクト直下の `output/` に保存する。Docker では `./output:/app/output` をマウントし、ホストとコンテナで同じパスを共有する。
- 環境変数 `RESPONSE_PATH_BASE` を指定すると、`output/` からの相対パスをもとにホスト上のフルパスを組み立ててレスポンスへ埋め込む。コンテナ配下のパス（例: `/app/output/...`）をそのまま返してもホストから参照できないため、Compose では `RESPONSE_PATH_BASE=${PWD}/output` のように指定してパス解決を行う。未指定の場合はコンテナ内絶対パスを返す。

## 3. 状態管理
- `interface StreamState { sessionId: string; presetId: string; phase: 'STOPPED'|'IDLE'|'SPEAK'; activeMotionId?: string; queueLength: number; }`
- `StreamSession` クラスが以下を保持:
  - `phase`
  - `presetId`
  - `idleLoopProcess: ChildProcess | null`
  - `speechProcess: ChildProcess | null`
  - `queue: SpeechTaskQueue`
  - `currentMotionId`
- ミューテックス (`AsyncLock`) を用い API からの `start`/`stop`/`text` 呼び出し間の競合を防ぐ。
- `status` API 用に読み取り専用スナップショットを提供。
- `GenerationService` はストリーム状態とは独立したジョブ（`generate` API呼び出し）を扱うため、`StreamSession` のロックとは切り離されている。現状は1リクエスト内のアクションを逐次処理し、API呼び出し単位で完結する（全体キュー／同時実行数制御は今後の拡張候補）。

## 4. IdleLoopController（待機・発話・任意アクションのプレイリスト）
- 入力: `presetProfile`（`idleMotions` / `speechMotions` / `speechTransitions` / `actions` を内包）、`outputUrl`, `ProcessManager`。
- 実装戦略: 「ffconcatファイルチェーン＋アトミック差し替え」で、`speak` と任意 `action` をタスク単位で割り込ませる設計にする。stdin追記は使わず、自己参照する `idle.txt` を基点にタスクffconcatを一度だけ読むよう書き換える。
  1. `start()` では、指定された `presetId` の `idleMotions`（Large/Smallに複数登録可）を ffprobe で秒数計測し、ClipPlanner.selectIdleClips で `MIN_IDLE_SEC` 以上になるまで並べたプレイリストを作る。ヘッダーに `ffconcat version 1.0` を付け、選ばれた idle 行の後に `file 'idle.txt'` で自己参照させた「現在のプリセット用 idle.txt」を生成する（キャラ切替時はこのファイルを差し替える）。
  2. ffmpeg は `-re -f concat -safe 0 -i idle.txt -c copy -f flv <output>` を `PLAYLIST_DIR` カレントで起動し、終了したら1秒後に自動再起動する。Node-Media-Server が RTMP/HTTP-FLV を提供する。
  3. `speak` や任意 `action` を再生したいときは、ClipPlanner/MediaPipeline が決めたクリップ列をもとにタスク用ffconcat（例: `speak-<taskId>.txt` なら enter→speech→exit→`idle.txt` 戻り、`action-<taskId>.txt` なら該当動画→`idle.txt` 戻り）を生成する。
  4. 生成したタスクffconcatを1回だけ読ませるため、`idle.txt` を一時ファイルに書き出してから `rename` で置換し、前後のidleも ClipPlanner で複数選んだうえで `file '<task ffconcat>'` と `file 'idle.txt'`（自己参照）を追加する。これによりタスク再生後は自動的に待機ループへ復帰する。
  5. 差し替え後に ffmpeg stderr の "Opening '<task ffconcat>'" やタスク内クリップのオープンログを監視し、検知できたら自己参照版 `idle.txt` を復旧する。検知に失敗した場合でも、タスク総尺＋idle尺に基づくフォールバックタイマーで自動復旧する。
  6. パス解決は `safe 0` 前提で絶対パス/`PLAYLIST_DIR` 相対どちらでも行える形にし、書き換えは常にアトミックリネームで行って再生中の破損を防ぐ。
- キャラクター変更をサポートする場合は stop→start で明示的に行い、別 `presetId` の start を同一ストリームの切替としては扱わない（並行ストリームは別プロセス/セッションで立ち上げる想定）。
- 待機モーションの末尾フレームと発話モーションの先頭フレームをデザイナー側で揃えておけば、プレイリスト挿入のみで「待機→発話→待機」が一切止まらず繋がる。

## 5. SpeechTaskQueue (将来実装)
- 役割: `text` エンドポイントから`SpeechTask`を受信順で管理。
- 2段階処理:
  - **prepare phase**: TTS実行や音声ファイル生成（並列OK、音声プロファイルに設定されたVOICEVOX URLを利用）。
  - **playback phase**: ffconcat チェーンへの差し込みで表現する。`IdleLoopController` 側でタスクffconcat（`speak` なら enter→speech→exit、任意 `action` ならその動画1本）を一時生成し、ClipPlannerで選んだ複数idle（Large/Smallプールから）を前後に挟んだ `idle.txt` へアトミック置換することでFIFO順に割り込みを実現する。現状の簡易実装は「一度だけ挿入」動作で、複数タスクのキュー管理はTODO。
- 実装案: Node の `EventEmitter` と Promise チェーンで自前キュー、または `p-queue` 等の軽量ライブラリ。
- 現段階では`enqueue`にTODOを入れ、APIからの呼び出しを受けるだけ。

## 6. GenerationService（generateエンドポイント）
- 役割: `POST /api/generate` のアクション列を処理し、音声合成と動画合成を行ってプロジェクト直下の `output/` にファイルを生成する。配信ストリームの状態とは独立して実行される。

### 6.1 リクエストボディ
```jsonc
{
  "stream": true,
  "presetId": "anchor-a",
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
        "motionId": "idle-a-large"
      }
    },
    {
      "action": "bow"
    }
  ]
}
```
- `stream`: `true` の場合は逐次レスポンス（chunked JSON / SSE）で生成完了ごとに結果をpush。`false`または未指定時は全アクション完了後にまとめて返す。
- `requests` は記述順に処理され、レスポンスの `id` はサーバー側で `1, 2, ...` と自動採番される（クライアント指定は不要）。
- `requests[].action`: `speak` / `idle` / 設定ファイルで定義した `presets[*].actions[].id` のいずれか。`speak` と `idle` は予約語のため `actions` には登録不可。
- `requests[].params`: アクション固有の入力。将来タグ経由で話速・ポーズを制御できるよう `tags: string[]` を受け付けておく。

### 6.2 アクション種別
- **speak**
  - 必須: `text`。`emotion` は任意（未指定時は `neutral`）。emotion指定があっても該当モーションが無い場合は `neutral` プールへフォールバックする。
  - リクエスト直下の `presetId` で指定されたキャラクターの `speechMotions` と `audioProfile` を利用する。
  - VOICEVOX で音声合成 → `MediaPipeline.normalizeAudio` で 48kHz ステレオ化 → `MediaPipeline.trimAudioSilence` で前後の無音を除去し、実際の発話部分だけを残す。この「トリミング済み音声」の尺を計測して発話モーションを割り当てる。対象キャラクターで `speechTransitions.enter/exit` が定義されている場合は、トリミング済み音声の前後にサイレントパディングを付与して `idle→talk` / `talk→idle` のブリッジ動画と同期させる。
  - `speechMotions` を emotion + type(Large/Small)でグループ化し、`animation-streamer-example` の `buildTimelinePlan` と同様に Largeで埋めて余りをSmallで補完。emotionに一致するモーションが無ければ `neutral` → その他任意順でフォールバック。
- **idle**
  - 必須: `durationMs`。任意: `motionId`（明示指定時はそのモーションだけで構成）、`emotion`（待機モーションの感情タグでフィルタ）。
  - リクエストの `presetId` で選択されたキャラクターの `idleMotions` をLarge優先/Small補完で `durationMs` をカバーする。`motionId` はそのキャラクターのモーションID空間内で照合する。
  - 音声は生成せず、必要に応じて `anullsrc` で無音AACを生成し動画長に合わせる。
- **任意アクション（presets[*].actions）**
  - `action` フィールドの値は選択されたキャラクターの `actions[].id`（小文字）と一致している必要がある。事前登録された動画1本を合成して出力し、動画に音声トラックが含まれていれば抽出して長さ調整のうえ再利用する。音声が存在しない場合のみ `anullsrc` を生成して多重化する。

### 6.3 処理フロー
1. `GenerationService` がリクエスト全体をバリデート。`requests` が空なら400。
2. `requests` を順次処理。各アクションは `GenerationJobContext` に共有リソース（設定・outputディレクトリ・VOICEVOXクライアント）を持つ。
3. `speak`:
   1. `VoicevoxClient.synthesize(text)` でWAV生成。
   2. `MediaPipeline.normalizeAudio` で 48kHz / stereo に揃えたあと、`MediaPipeline.trimAudioSilence` で前後無音を削除。トリミング済み音声を発話本体として保持し、このファイルの長さを `ClipPlanner` の入力に使う。
   3. `ClipPlanner.selectSpeechClips(presetId, emotion, duration)` がキャラクター固有のモーションリストを返す。`preset.speechTransitions.enter/exit` が設定されていれば、リストの先頭にidle→talk、末尾にtalk→idleのトランジションを差し込み、音声側は前後にサイレントパディングを入れて同期させる。
   4. `MediaPipeline.compose(clips, audioPath, duration)` が concat用リストを作り、ffmpegで MP4 を出力（音声はトリミング済み＋パディング済みのものを利用）。
4. `idle`: `ClipPlanner.selectIdleClips(presetId, duration, emotion?)` → `MediaPipeline.compose(clips, null, duration)`。
5. 任意アクション: 選択キャラクターの `actions` から動画パスを取得し単体で `compose`。このとき `planCustomAction` が動画に含まれる音声トラックを `MediaPipeline.extractAudioTrack` → `fitAudioDuration` で整形し、存在しない場合のみ `createSilentAudio` を使う。よってアクション独自の効果音やBGMはモーションと一緒に再生される。
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
  - `selectSpeechClips(presetId, emotion, duration)` と `selectIdleClips(presetId, duration, emotion?)` を提供。`animation-streamer-example/src/lib/timeline.ts` の Large/Small選択ロジックをサーバーサイドへ移植し、durationをカバーするまでランダムにLargeを優先・余剰をSmallで補完する。
  - キャラクターとemotionごとのプールを事前に構築し、モーションがヒットしない場合は `neutral` → `その他` の順でフォールバック。
- **MediaPipeline**
  - VOICEVOX呼び出しは `VoicevoxClient` が担い、`MediaPipeline` は受け取ったWAVを正規化・加工する役割に専念する。
  - `normalizeAudio(input)`：48kHz / stereo / `pcm_s16le` へ変換し、以降の処理を同一フォーマットに統一。
  - `trimAudioSilence(input, {levelDb})`：`silenceremove → areverse → silenceremove → areverse` の2段構成で、先頭・末尾の無音を独立して削除する。デフォルトでは -70dB 未満を無音とみなし、発話中のポーズは残る。戻り値はトリミング済みファイルパス。
  - `compose(clips, audioPath | null, durationMs)`：`clips` から `concat` ファイルを生成し、必要数だけ `ffmpeg -stream_loop` or 事前コピーで並べる。映像は `-c:v copy` で元素材のエンコード/解像度を維持し、音声が無い場合は `anullsrc` を入力に追加してAACトラックを生成。音声がある場合は、トリミング済み音声（＋必要なサイレントパディング、またはアクション動画から抽出したBGM）を入力に使う。
    - モーション動画に残っている音声ストリームは `-map 0:v:0 -map 1:a:0` で強制的に破棄し、`compose` に渡した音声入力（VOICEVOX / 無音WAV / アクション用に抽出した音声）のみを最終MP4へ多重化する。したがって `presets[].speechMotions` / `presets[].idleMotions` / `presets[].speechTransitions` に音声トラックが残っていても出力へ混入しない一方、カスタムアクションは事前に抽出した音声がそのまま利用される。
  - 合成ファイルはジョブディレクトリ内に MP4 で書き出し、`GenerationService` が固定の `output/` へ移動してクライアントへ絶対パスを返す。映像コーデックは素材準拠（`copy`）で、音声のみAACへ揃える。`RESPONSE_PATH_BASE` が設定されている場合はここでホスト側のパスへ書き換える。
  - 生成中の一時ファイルは `CleanupService` に登録しておき、成功/失敗に関わらず削除。
- ストリーム配信用の `createIdleProcess` / `createSpeechProcess` も将来ここにまとめるが、現段階では `generate` 用 `compose` が中心。
- ffmpeg呼び出しは `fluent-ffmpeg` か `child_process.spawn` のどちらでもよいが、`-f concat -safe 0 -i <list>` + `-i <audio>` + `-c:v copy -c:a aac -shortest` を基本形とする。

## 8. API 仕様 (初期)
### POST /api/stream/start
- Body: `{ "presetId": "required", "debug": false }`
  - `presetId`: 使用キャラクター必須。将来認証を導入する場合はヘッダー/ボディで受け付ける。
  - `debug`: `true` の場合、`output/stream` 内の生成ファイルを自動削除しない（デバッグ用）。デフォルト `false`。
- 成功 200: `{ "status": "IDLE", "sessionId": "...", "currentMotionId": "idle-wave", "presetId": "..." }`
- 既に待機中に同一 `presetId` で呼ばれた場合は同レスポンスで冪等。それ以外（別 `presetId`）はこのストリームでは 409（別セッションを立ち上げる場合はプロセスを分ける）。
- `debug=false` の場合、start時に `output/stream` をクリアし、stop時および再生完了後に不要なファイルを自動削除する。

### POST /api/stream/stop
- Body: `{}`
- 成功 200: `{ "status": "STOPPED" }`
- 実行中タスクがあればキャンセル。

### POST /api/stream/text
- ボディは `/api/generate` と同じアクション列フォーマット（`presetId` / `requests[]`）。違いは「生成物をファイルに書き出さず、ストリームに順次割り込ませて再生する」点。

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
- 例: `{ "status": "IDLE", "currentMotionId": "idle-think", "queueLength": 0, "uptimeMs": 12345 }

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

## 11. 音声入力機能（Audio Input Support）

### 11.1 概要
`speak` アクションはテキスト入力に加えて、音声ファイルの直接入力をサポートする。音声入力時は TTS をスキップして直接モーション合成に進むか、STT でテキスト化してから TTS を通すかを選択できる。

### 11.2 パラメータ拡張
```typescript
interface SpeakParams {
  // 入力ソース（どちらか一方を指定）
  text?: string              // 既存: テキスト → TTS → 音声
  audio?: {
    path?: string            // 音声ファイルパス（サーバーローカル）
    base64?: string          // Base64エンコード音声データ
    transcribe?: boolean     // true: STT→TTS, false/未指定: 直接使用
  }

  emotion?: string           // 感情（モーション選択用）
}
```

### 11.3 リクエスト例
```jsonc
// テキスト入力（既存）
{
  "action": "speak",
  "params": { "text": "こんにちは", "emotion": "happy" }
}

// 音声ファイル直接使用
{
  "action": "speak",
  "params": {
    "audio": { "path": "/path/to/voice.wav" },
    "emotion": "neutral"
  }
}

// Base64音声直接使用
{
  "action": "speak",
  "params": {
    "audio": { "base64": "UklGR..." }
  }
}

// 音声→STT→TTS（声質変換）
{
  "action": "speak",
  "params": {
    "audio": { "path": "/path/to/voice.wav", "transcribe": true },
    "emotion": "happy"
  }
}
```

### 11.4 処理フロー
```text
┌─────────────────────────────────────────────────────────────┐
│                        入力                                  │
├─────────────┬─────────────────┬─────────────────────────────┤
│    text     │  audio (direct) │     audio (transcribe)      │
└──────┬──────┴────────┬────────┴──────────────┬──────────────┘
       │               │                       │
       │               │                  ┌────▼────┐
       │               │                  │   STT   │
       │               │                  │(nodejs- │
       │               │                  │ whisper)│
       │               │                  └────┬────┘
       │               │                       │
       ▼               │                       ▼
  ┌─────────┐          │                  ┌─────────┐
  │   TTS   │          │                  │   TTS   │
  │(VOICEVOX)│         │                  │(VOICEVOX)│
  └────┬────┘          │                  └────┬────┘
       │               │                       │
       ▼               ▼                       ▼
  ┌─────────────────────────────────────────────────┐
  │              音声正規化・トリム                   │
  └─────────────────────┬───────────────────────────┘
                        │
                        ▼
  ┌─────────────────────────────────────────────────┐
  │           モーション計画・動画合成                │
  └─────────────────────────────────────────────────┘
```

### 11.5 STTクライアント（OpenAI互換API）
- **バックエンド**: OpenAI互換APIをサポートする任意のSTTサーバー
  - **faster-whisper-server** (推奨): Docker で簡単に起動、高速
  - **OpenAI Whisper API**: クラウドサービス
- **特徴**:
  - OpenAI SDK を使用した統一インターフェース
  - ローカルサーバーとクラウドサービスを設定で切り替え可能
  - 日本語対応

```typescript
// src/services/stt.ts
import OpenAI from 'openai'

export class STTClient {
  private client: OpenAI
  private model: string
  private language: string

  constructor(options: { baseUrl: string; apiKey?: string; model?: string; language?: string }) {
    this.client = new OpenAI({
      baseURL: options.baseUrl,
      apiKey: options.apiKey ?? 'dummy-key',
    })
    this.model = options.model ?? 'whisper-1'
    this.language = options.language ?? 'ja'
  }

  async transcribe(audioPath: string): Promise<string> {
    const audioFile = fs.createReadStream(audioPath)
    const response = await this.client.audio.transcriptions.create({
      file: audioFile,
      model: this.model,
      language: this.language,
    })
    return response.text.trim()
  }
}
```

### 11.6 設定拡張
STT設定はトップレベルに配置（プリセット共通）:
```json
{
  "server": { ... },
  "rtmp": { ... },
  "stt": {
    "baseUrl": "http://localhost:8000/v1",
    "model": "whisper-1",
    "language": "ja"
  },
  "presets": [...]
}
```

- `stt.baseUrl`: OpenAI互換APIのベースURL（ローカル: `http://localhost:8000/v1`、OpenAI: `https://api.openai.com/v1`）
- `stt.apiKey`: APIキー（OpenAI使用時は必須、ローカルサーバーは通常不要）
- `stt.model`: 使用するモデル（`whisper-1` など）
- `stt.language`: 音声認識言語（デフォルト: `ja`）

### 11.7 バリデーション
- `text` と `audio` は排他（両方指定は 400 エラー）
- `audio` 指定時は `path` か `base64` のどちらか一方が必須
- `audio.transcribe` は `audio` 指定時のみ有効
- サポートする音声フォーマット: WAV, MP3, OGG, FLAC（ffmpeg/whisper が対応するもの）

### 11.8 実装対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/types/generate.ts` | `SpeakParams`, `AudioInput` 型を追加 |
| `src/api/schema.ts` | speak パラメータのバリデーション追加 |
| `src/services/generation.service.ts` | `buildSpeakPlan()` で音声入力の分岐処理 |
| `src/services/stt.ts` | 新規: STTClient クラス |
| `src/config/schema.ts` | トップレベルに `stt` 設定を追加 |
| `src/config/loader.ts` | `ResolvedSTTConfig` 型と設定解決ロジック追加 |

## 12. 動画キャッシュ機能（Video Cache）

### 12.1 概要
`/api/generate` で生成した動画をキャッシュし、同一設定・同一テキストのリクエスト時に再生成をスキップして既存ファイルを返す機能。ローカルPC環境での利用を想定し、キャッシュの削除はユーザーが手動で行う。

### 12.2 対象範囲

| API | アクション | キャッシュ |
|-----|-----------|----------|
| `/api/generate` | speak | 対象 |
| `/api/generate` | idle | 対象 |
| `/api/generate` | 結合動画（`stream: false`） | 対象 |
| `/api/generate` | custom | 非対象 |
| `/api/stream/*` | 全て | 非対象 |

- custom アクションは事前登録済み動画を再生するだけのためキャッシュ不要。
- **`/api/stream` のファイル名は従来通りランダムUUID**を使用し、キャッシュ機能の影響を受けない（`output/stream/` 内のファイルは再生後自動削除される既存仕様のまま）。

### 12.3 リクエストパラメータ

`GenerateRequestPayload` に `cache` パラメータを追加:

```typescript
interface GenerateRequestPayload {
  presetId: string
  stream?: boolean
  cache?: boolean
  requests: GenerateRequestItem[]
  debug?: boolean
}
```

- `cache: false`（デフォルト）: キャッシュチェックせず常に生成。ファイル名はハッシュ値+UUID、ログは追記。
- `cache: true`: キャッシュがあればそれを返し、なければ生成してキャッシュ。

### 12.4 ファイル名

`/api/generate` のファイル名は `cache` の値によって変わります:

- `cache: true` の場合: `output/{hash}.mp4`
- `cache: false` の場合: `output/{hash}-{uuid}.mp4`

ハッシュはキャッシュキー（後述）をSHA-256でハッシュ化して使用。

### 12.5 キャッシュキー（ハッシュの元）

アクション種別・入力種別ごとにキャッシュキーを構成:

**speak アクション（text入力）:**
```json
{
  "type": "speak",
  "presetId": "anchor-a",
  "inputType": "text",
  "text": "こんにちは",
  "ttsEngine": "voicevox",
  "ttsSettings": { "speakerId": 1, "speedScale": 1.1 },
  "emotion": "neutral"
}
```

**speak アクション（audio直接入力）:**
```json
{
  "type": "speak",
  "presetId": "anchor-a",
  "inputType": "audio",
  "audioHash": "e3b0c44298fc1c149afbf4c8996fb924...",  // 入力音声ファイルのSHA-256ハッシュ
  "emotion": "neutral"
}
```

**speak アクション（audio+transcribe入力）:**
```json
{
  "type": "speak",
  "presetId": "anchor-a",
  "inputType": "audio_transcribe",
  "audioHash": "e3b0c44298fc1c149afbf4c8996fb924...",  // 入力音声ファイルのSHA-256ハッシュ
  "ttsEngine": "voicevox",
  "ttsSettings": { "speakerId": 1, "speedScale": 1.1 },
  "emotion": "neutral"
}
```

音声入力の場合、`audio.path` または `audio.base64` のどちらでも、音声データの内容をSHA-256でハッシュ化してキャッシュキーに含める。これにより同じ音声ファイルが入力された場合にキャッシュヒットする。

**idle アクション:**
```json
{
  "type": "idle",
  "presetId": "anchor-a",
  "durationMs": 2000,
  "motionId": "idle-a-large",  // 指定時のみ
  "emotion": "neutral"
}
```

**結合動画（`stream: false`）:**
```json
{
  "type": "combined",
  "presetId": "anchor-a",
  "actionHashes": ["hash1", "hash2", "hash3"]
}
```

### 12.6 出力ログ

生成のたびに `output/output.jsonl` へ追記（JSONL形式: 1行1JSON）:

```jsonl
{"file":"a1b2c3d4e5f6.mp4","type":"speak","inputType":"text","preset":"default","tts":"voicevox","speakerId":1,"emotion":"neutral","text":"こんにちは","createdAt":"2024-01-01T00:00:00Z"}
{"file":"b2c3d4e5f6a7.mp4","type":"speak","inputType":"audio","preset":"default","emotion":"neutral","audioHash":"e3b0c442...","createdAt":"2024-01-01T00:00:01Z"}
{"file":"c3d4e5f6a7b8.mp4","type":"speak","inputType":"audio_transcribe","preset":"default","tts":"voicevox","speakerId":1,"emotion":"happy","audioHash":"a1b2c3d4...","text":"こんにちは","createdAt":"2024-01-01T00:00:02Z"}
{"file":"d4e5f6a7b8c9.mp4","type":"idle","preset":"default","durationMs":2000,"emotion":"neutral","createdAt":"2024-01-01T00:00:03Z"}
{"file":"abc123def456.mp4","type":"combined","preset":"default","actions":[{"type":"speak","inputType":"text","text":"こんにちは"},{"type":"idle","durationMs":2000}],"createdAt":"2024-01-01T00:00:04Z"}
```

### 12.7 キャッシュフロー

```text
リクエスト受信
    │
    ▼
キャッシュキー生成（設定+テキスト → ハッシュ）
    │
    ▼
cache = true ?
    │
    ├─ No ──▶ 生成 ──▶ {hash}.mp4 保存 ──▶ ログ追記 ──▶ レスポンス
    │
    └─ Yes ─▶ output/{hash}.mp4 存在する？
                  │
                  ├─ Yes ──▶ そのパスを返す（生成スキップ）
                  │
                  └─ No ───▶ 生成 ──▶ {hash}.mp4 保存 ──▶ ログ追記 ──▶ レスポンス
```

### 12.8 起動時のログ同期

サーバー起動時に `output/output.jsonl` を読み込み、実際のファイル存在と照合:

1. ログファイルを1行ずつパース
2. 各エントリの `file` が `output/` に存在するか確認
3. 存在しないエントリを除外した新しいログファイルを書き出し

これによりユーザーが手動でファイルを削除した場合もログが実態と同期される。

### 12.9 並行リクエストの扱い

同じキャッシュキーで同時にリクエストが来た場合:

- 両方とも生成を実行（ロック機構は設けない）
- 同じファイル名なので後から書き込んだ方が上書き
- 実用上の問題はない（同一内容のファイルが生成されるため）

### 12.10 実装対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/types/generate.ts` | `cache` パラメータ追加 |
| `src/api/schema.ts` | `cache` バリデーション追加 |
| `src/services/generation.service.ts` | キャッシュキー生成、キャッシュチェック、ログ追記処理 |
| `src/services/cache.service.ts` | 新規: キャッシュキー生成、ログ管理、起動時同期 |
| `src/app.ts` | 起動時のログ同期処理呼び出し |

### 12.11 注意事項

- **モーション選択のランダム性**: speak/idle のモーション選択には `Math.random()` が使われている。キャッシュ有効時は最初に生成された動画が返されるため同じ見た目になるが、キャッシュ無効時は毎回異なる動画が生成される。
- **設定変更時**: preset の設定（モーションファイルなど）を変更した場合、古いキャッシュが使われる可能性がある。ユーザーが適宜キャッシュを削除する運用を想定。
- **`/api/stream` への影響なし**: `/api/stream` 経由のファイル生成（`forStreamPipeline: true`）はキャッシュ機能の対象外。ファイル名も従来通りランダムUUIDを使用し、`output/stream/` への保存と自動削除の仕様は変更しない。

## 13. 未実装項目 / TODO
- `text` / `generate` エンドポイント内部のTTS呼び出し、音声合成、ストリーム割込み／MP4出力処理。
- 音声/動画素材の正当性チェック、自動ダウンロード機構。
- 簡易認証(APIキー)とTLS化。
- 単体テスト・結合テスト。
