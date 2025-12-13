# Animation Streamer – 概要設計書

## 目的
- ローカル環境で待機モーション動画を常時ストリームし、OBSなどの配信ツールから取得してYouTube等へ中継できるようにする。
- テキスト入力に応じて音声を生成し、音声と発話用モーション動画を組み合わせて待機ストリームへ差し込むための土台を用意する。
- 動画・音声素材やTTS設定をJSONで柔軟に管理し、あとからモーションやキャラクターを増やしやすくする（リクエストで `presetId` を指定して切り替える）。

## スコープ
- `start`/`stop` エンドポイントを備えたNode.jsベースのローカルサーバー。
- RTMP/HTTP-FLV配信を提供しOBSのメディアソースとして利用可能にする。
- 待機モーションを複数登録し、各クリップ再生終了ごとにランダム切り替えでループ再生する仕組み。
- `text` エンドポイントのインタフェースを配信用に定義し、`presetId` やアクション列を受けてストリームへ割り込ませる。
- ストリームとは独立した `generate` エンドポイントを定義し、`speak`/`idle`/任意アクションを並べたJSONを受け取って順次クリップを生成する。`stream`フラグが `true` の場合はアクション完了ごとに結果をストリーミング返却、`false` の場合は一括返却。

## 技術選定
- **ランタイム**: Node.js (TypeScript)。
- **Webフレームワーク**: Express。シンプルなREST APIとDI構造が取りやすい。
- **配信サーバー**: node-media-server（RTMP/HTTP-FLV）。OBSから `rtmp://localhost:1935/live/main` を参照。
- **メディア制御**: ffmpeg + fluent-ffmpeg ラッパー。映像ループや音声ミックスをシェルプロセスとして管理。
- **設定**: `config/stream-profile.json` を起動時に読み込み。キャラクターごとに待機/発話モーションやVOICEVOX設定を持たせ、リクエストで `presetId` を指定して選択する。`server.port`/`server.host` や任意の `server.apiKey`（`X-API-Key` で検証）も定義し、ホットリロードは不要。
- **状態管理**: アプリ内の `StreamSession` が現在の状態・実行中プロセス・キューを集中管理。

## 全体アーキテクチャ
```
Client (OBS, API caller)
        |
   Express API (REST)  -- status/start/stop/text/generate
        |
   StreamService (State machine & orchestration)
   |          \                    \
IdleLoop      SpeechTaskQueue (TODO) GenerationService (mp4出力)
Controller     \                    /
               MediaPipeline (ffmpeg, TTS, motions/output)
        |
 node-media-server (RTMP)
        |
 OBS -> YouTube Live
```

## 主なコンポーネント
- **Express API 層**: 認証(ローカルAPIキー想定)、入力バリデーション、`StreamService` 呼び出し。
- **StreamService / StreamSession**: 状態遷移 (STOPPED, IDLE, SPEAK) とプロセスハンドルを保持。待機ループの開始・停止、タスクキューへの操作口を提供。
- **IdleLoopController**: `idle.txt`（自己参照ループ）を常時入力にし、タスクごとに一時ffconcat（例: `speak-<task>.txt` で enter→speech→exit→idle戻り、`action-<task>.txt` で任意クリップ→idle戻り）を生成。`idle.txt` はキャラクターの `idleMotions`（Large/Small複数可）から ClipPlanner で一定長を埋める形で組み、タスク挿入時も同じIdleプランナーで前後のidleを並べる。`idle.txt` を一時ファイル経由で「数本のidle→タスクffconcat→idle自己参照」に書き換え、ffmpeg stderr でタスクffconcatのオープンを検知したら自己参照版へ復旧する。検知できない場合も総尺ベースのフォールバックタイマーでループに戻す。
- **SpeechTaskQueue (将来実装)**: `text` APIから受けたタスクを受信順でFIFO管理。生成完了が前後しても再生順は保証する。
- **GenerationService**: `POST /api/generate` のアクション列をバリデーションし、`stream` フラグに応じて逐次 or 一括レスポンスを返す。`speak`/`idle`/任意アクションごとにVOICEVOX→モーション合成を実行する。
- **ClipPlanner**: `animation-streamer-example` に実装されている Large/Small clip allocation ロジックをサーバー側に移植。emotionやモーションタイプに応じて必要時間をカバーするクリップリストを決定する。
- `speechTransitions` が設定されている場合は、`speak` アクションの先頭/末尾に idle→talk / talk→idle のトランジション動画を自動で挿入し、音声にも同じ長さのサイレントパディングを追加してシームレスに接続する。トランジションにも `emotion` を指定でき、`speechMotions` と同じく「一致 → neutral → その他」の順で最適なモーションが選ばれる。
- **MediaPipeline**: ffmpegプロセスの生成/監視と、VOICEVOXなどのTTSとの橋渡し。音声と動画の合成、一時ファイルの管理を担当。`speak`ではTTS→WAV→mp4多重化、`idle`や任意アクションでは動画＋無音音声を多重化する。
- **ConfigLoader**: JSONを読み込み、型チェック済みの設定オブジェクトをDIコンテナへ供給。

## リクエストフロー（start/stop）
1. **POST /api/stream/start**
   - Body: `{ "presetId": "required", "debug": false }`
     - `presetId`: 使用キャラクター必須。
     - `debug`: `true` で `output/stream` のファイル自動削除を無効化（デバッグ用）。
   - 状態がSTOPPEDなら待機ループを開始（同一presetIdで既にIDLE状態なら冪等）。`IdleLoopController` が指定された `presetId` の `idleMotions`（Large/Small複数）から ClipPlanner で一定長の待機シーケンスを作り、現在のプリセット用 `idle.txt`（自己参照）を生成してffmpegを起動。`speak` や任意 `action` のタスクffconcatはリクエストが来たときにその都度一時生成して `idle.txt` に1回だけ挿入し、再生検知後に自己参照ループへ戻す。異常終了時は自動再起動し、RTMP 送出を継続する。
   - レスポンスは現在の状態と使用中のモーションIDを返却。稼働中に別 `presetId` で再度 start が呼ばれた場合は同時別セッションを立てる想定のため、このストリームでは 409 などで拒否し、切り替えたい場合は stop→start で明示する。
2. **POST /api/stream/stop**
   - Body: `{}`。
   - 進行中の待機ループと音声タスクを停止し、ffmpeg子プロセスを終了。
   - 一時ファイルなどをクリーンアップし、状態をSTOPPEDへ。

## リクエストフロー（/api/stream/text - ストリーム割込み）
1. **POST /api/stream/text**
   - リクエスト形式は `/api/generate` と同じ（`presetId` / `requests[]` のアクション列）。`speak`/`idle`/任意 `action` を含む複数アクションの並びをストリーム再生タスクとしてキューに積む。
   - `SpeechTaskQueue` にタスクを積み、`IdleLoopController` が各タスクのffconcat（例: enter→speech→exit→idle戻り or 任意action→idle戻り）を一時生成して `idle.txt` に1回だけ挿入し再生する。

## リクエストフロー（generate）
1. クライアントは `presetId`, `stream`, `requests[]` を含むJSONをPOST（例: Section「Generateアクションリクエスト」参照）。
2. `GenerationService` がアクションを先頭から順次処理。
   - `speak`: VOICEVOXで音声合成 → ClipPlannerが emotion + Large/Small で発話モーションを決定 → `MediaPipeline` が concat + AAC でmp4を出力。キャラクター固有の `speechTransitions` があれば自動で差し込む。
   - `idle`: `durationMs` を満たすまでキャラクターの待機モーションをLarge優先で並べ、無音AACと多重化。
   - 任意アクション: 該当キャラクターの `actions` から動画を単発で出力。
3. `stream = true` の場合は処理完了したアクションから順にNDJSONで返却。`false` の場合は全アクション完了後に配列で返却。
4. `stream = false` の場合は全アクションを1本のタイムラインへ並べてffmpegで一括レンダリングし、最終MP4のみ `combined` として返す（個別クリップは返却しない）。
5. 生成ファイルはプロジェクト直下の `output/` に保存され、OBSや他プロセスが参照できる（コンテナ利用時は `RESPONSE_PATH_BASE` でホストのフルパスを返す）。

## 状態遷移
```
STOPPED --start--> IDLE --text--> SPEAK --(task done)--> IDLE
IDLE --stop--> STOPPED
SPEAK --stop--> STOPPED
```

## Generateアクションリクエスト
```jsonc
{
  "stream": true,
  "presetId": "anchor-a",
  "requests": [
    { "action": "speak", "params": { "text": "こんにちは", "emotion": "happy" } },
    { "action": "idle", "params": { "durationMs": 1000 } },
    { "action": "start" }
  ]
}
```
- `requests` は記述順に処理され、レスポンスの `id` はサーバーが `1, 2, ...` と自動採番する。
- `presetId` はリクエスト直下で必須指定（バッチ内の全アクションが同じキャラクターを参照する）。未指定の場合は400。
- `speak` は `text` または `audio` のいずれかを指定（排他）。`emotion` は任意。emotionに合うモーションが無い場合は `neutral` プールを自動選択。
- `idle` は `durationMs` 必須。`motionId` を指定するとそのキャラクター内でそのモーションだけでタイムラインを組む。
- 任意 `action` の値は選択されたキャラクターの `actions[].id` のいずれかに一致している必要がある（`speak`/`idle` は登録不可）。

## speakアクションの入力形式
`speak` アクションはテキスト入力と音声入力の両方をサポートする。

### テキスト入力（既存）
```jsonc
{ "action": "speak", "params": { "text": "こんにちは", "emotion": "happy" } }
```

### 音声入力（直接使用）
音声ファイルをそのままモーション合成に使用する。TTS をスキップするため高速。
```jsonc
// ファイルパス指定
{ "action": "speak", "params": { "audio": { "path": "/path/to/voice.wav" } } }

// Base64エンコード
{ "action": "speak", "params": { "audio": { "base64": "UklGR..." } } }
```

### 音声入力（STT→TTS）
入力音声を STT でテキスト化し、TTS で再合成する。声質変換的な用途に使用。
```jsonc
{
  "action": "speak",
  "params": {
    "audio": { "path": "/path/to/voice.wav", "transcribe": true },
    "emotion": "happy"
  }
}
```

### 処理フロー
```
text入力        → TTS(VOICEVOX) → 音声正規化 → モーション合成
audio入力       → 音声正規化 → モーション合成
audio+transcribe → STT(whisper) → TTS(VOICEVOX) → 音声正規化 → モーション合成
```

## 動画キャッシュ機能
`/api/generate` で生成した動画をキャッシュし、同一設定・同一テキストのリクエスト時に再生成をスキップして既存ファイルを返す機能。

### 対象範囲
| API | キャッシュ対象 |
|-----|---------------|
| `/api/generate` | speak/idle/結合動画 |
| `/api/stream/*` | 非対象（再生後自動削除のため） |

- custom アクションは事前登録済み動画を再生するだけのためキャッシュ不要。
- **`/api/stream` のファイル名は従来通りランダムUUID**（変更なし）。

### キャッシュ制御
- リクエストに `cache: boolean` パラメータを追加（デフォルト: `false`）。
- `false`: キャッシュチェックせず常に生成（ファイル名はハッシュ値、ログは追記）。
- `true`: キャッシュがあればそれを返し、なければ生成。

### ファイル名とログ
- `/api/generate` のファイル名は常にハッシュ値（設定+テキストから算出）。
- 生成のたびに `output/output.jsonl` へ追記（JSONL形式）。
- 起動時にログファイルを実態と同期（存在しないファイルのエントリを削除）。

### キャッシュキー（ハッシュの元）
- **speak (text入力)**: テキスト、TTSエンジン、TTS設定、emotion、preset ID
- **speak (audio直接)**: 入力音声のハッシュ、emotion、preset ID
- **speak (audio+transcribe)**: 入力音声のハッシュ、TTSエンジン、TTS設定、emotion、preset ID
- **idle**: durationMs、motionId、emotion、preset ID
- **結合動画**: 各アクションのハッシュを結合してハッシュ化

### 運用
- キャッシュ削除はユーザーが `output/` 内を手動で行う（ローカルPC前提）。
- モーション選択にはランダム性があるため、キャッシュ無効時は毎回異なる動画が生成される。

## 将来拡張の指針
- `text` エンドポイント：TTS連携、音声と発話モーションの合成、待機への復帰を順次処理する。
- `generate` エンドポイント：今回定義したアクションフローを基に、タグやemotionの細分化、複数キャラクターなどへ拡張する。
- 配信形式：node-media-serverでHLS/LL-HLSを有効化し、OBS以外のクライアントへの配信も可能にする。
- 設定テンプレ：モーションカテゴリ、音声プロファイル、TTSエンジン別設定の追加。
