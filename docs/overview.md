# Animation Streamer – 概要設計書

## 目的
- ローカル環境で待機モーション動画を常時ストリームし、OBSなどの配信ツールから取得してYouTube等へ中継できるようにする。
- テキスト入力に応じて音声を生成し、音声と発話用モーション動画を組み合わせて待機ストリームへ差し込むための土台を用意する。
- 動画・音声素材やTTS設定をJSONで柔軟に管理し、あとからモーションを増やしやすくする（一人キャラクター想定のため音声プロファイルは1件固定）。

## スコープ
- `start`/`stop` エンドポイントを備えたNode.jsベースのローカルサーバー。
- RTMP/HTTP-FLV配信を提供しOBSのメディアソースとして利用可能にする。
- 待機モーションを複数登録し、各クリップ再生終了ごとにランダム切り替えでループ再生する仕組み。
- `text` エンドポイントのインタフェースを先行定義（内部処理はTODO）。
- ストリームとは独立した `generate` エンドポイントを定義し、`speak`/`idle`/任意アクションを並べたJSONを受け取って順次クリップを生成する。`stream`フラグが `true` の場合はアクション完了ごとに結果をストリーミング返却、`false` の場合は一括返却。

## 技術選定
- **ランタイム**: Node.js (TypeScript)。
- **Webフレームワーク**: Express。シンプルなREST APIとDI構造が取りやすい。
- **配信サーバー**: node-media-server（RTMP/HTTP-FLV）。OBSから `rtmp://localhost:1935/live/main` を参照。
- **メディア制御**: ffmpeg + fluent-ffmpeg ラッパー。映像ループや音声ミックスをシェルプロセスとして管理。
- **設定**: `config/stream-profile.json` を起動時に読み込み。待機モーション複数＋単一音声プロファイル（VOICEVOXのURLやSpeaker ID含む）に加えて `server.port`/`server.host` や任意の `server.apiKey`（`X-API-Key` で検証）を定義し、ホットリロードは不要。
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
               MediaPipeline (ffmpeg, TTS, assets)
        |
 node-media-server (RTMP)
        |
 OBS -> YouTube Live
```

## 主なコンポーネント
- **Express API 層**: 認証(ローカルAPIキー想定)、入力バリデーション、`StreamService` 呼び出し。
- **StreamService / StreamSession**: 状態遷移 (IDLE, IDLING, SPEECH, STOPPED) とプロセスハンドルを保持。待機ループの開始・停止、タスクキューへの操作口を提供。
- **IdleLoopController**: 複数の待機モーションを管理。1つのffmpegプロセスに`concat`デマルチプレクサでプレイリストを流し込み、各動画の終了直前に次モーションをランダム選択して書き込むことでフレーム落ちなく切り替える。発話モーションも同じプレイリストに割り込み挿入し、待機→発話→待機の継ぎ目でフレームギャップを生まない。
- **SpeechTaskQueue (将来実装)**: `text` APIから受けたタスクを受信順でFIFO管理。生成完了が前後しても再生順は保証する。
- **GenerationService**: `POST /api/generate` のアクション列をバリデーションし、`stream` フラグに応じて逐次 or 一括レスポンスを返す。`speak`/`idle`/任意アクションごとにVOICEVOX→モーション合成を実行する。
- **ClipPlanner**: `animation-streamer-example` に実装されている Large/Small clip allocation ロジックをサーバー側に移植。emotionやモーションタイプに応じて必要時間をカバーするクリップリストを決定する。
- `speechTransitions` が設定されている場合は、`speak` アクションの先頭/末尾に idle→talk / talk→idle のトランジション動画を自動で挿入し、音声にも同じ長さのサイレントパディングを追加してシームレスに接続する。トランジションにも `emotion` を指定でき、`speechMotions` と同じく「一致 → neutral → その他」の順で最適なモーションが選ばれる。
- **MediaPipeline**: ffmpegプロセスの生成/監視と、VOICEVOXなどのTTSとの橋渡し。音声と動画の合成、一時ファイルの管理を担当。`speak`ではTTS→WAV→mp4多重化、`idle`や任意アクションでは動画＋無音音声を多重化する。
- **ConfigLoader**: JSONを読み込み、型チェック済みの設定オブジェクトをDIコンテナへ供給。

## リクエストフロー（start/stop）
1. **POST /api/start**
   - 状態がIDLE/STOPPEDなら待機ループを開始。
   - `IdleLoopController` がffmpeg(`concat`入力)を起動し、最初の待機モーションをプレイリストに流し込む。
   - レスポンスは現在の状態と使用中のモーションIDを返却。
2. **POST /api/stop**
   - 進行中の待機ループと（将来的に）音声タスクを停止し、ffmpeg子プロセスを終了。
   - 一時ファイルなどをクリーンアップし、状態をSTOPPEDへ。

## リクエストフロー（generate）
1. クライアントは `stream`, `defaults`, `requests[]` を含むJSONをPOST（例: Section「Generateアクションリクエスト」参照）。
2. `GenerationService` がアクションを先頭から順次処理。
   - `speak`: VOICEVOXで音声合成 → ClipPlannerが emotion + Large/Small で発話モーションを決定 → `MediaPipeline` が concat + AAC でmp4を出力。
   - `idle`: `durationMs` を満たすまで待機モーションをLarge優先で並べ、無音AACと多重化。
   - 任意アクション: `config.actions` の動画を単発で出力。
3. `stream = true` の場合は処理完了したアクションから順にNDJSONで返却。`false` の場合は全アクション完了後に配列で返却。
4. `stream = false` の場合は全アクションを1本のタイムラインへ並べてffmpegで一括レンダリングし、最終MP4のみ `combined` として返す（個別クリップは返却しない）。
5. 生成ファイルは `assets.tempDir` 配下に保存され、OBSや他プロセスが参照できる。

## 状態遷移
```
IDLE --start--> IDLING --text--> SPEECH --(speech done)--> IDLING
IDLING --stop--> STOPPED
SPEECH --stop--> STOPPED
STOPPED --start--> IDLING
```

## Generateアクションリクエスト
```jsonc
{
  "stream": true,
  "defaults": {
    "emotion": "neutral",
    "idleMotionId": "idle-default-large"
  },
  "requests": [
    { "action": "speak", "params": { "text": "こんにちは", "emotion": "happy" } },
    { "action": "idle", "params": { "durationMs": 1000 } },
    { "action": "start" }
  ]
}
```
- `requests` は記述順に処理され、レスポンスの `id` はサーバーが `1, 2, ...` と自動採番する。
- `speak` は `text` 必須／`emotion` 任意。emotionに合うモーションが無い場合は `neutral` プールを自動選択。
- `idle` は `durationMs` 必須。`motionId` を指定するとそのモーションだけでタイムラインを組む。
- 任意 `action` の値は `config.actions[].id` のいずれかに一致している必要がある（`speak`/`idle` を登録することはできない）。

## 将来拡張の指針
- `text` エンドポイント：TTS連携、音声と発話モーションの合成、待機への復帰を順次処理する。
- `generate` エンドポイント：今回定義したアクションフローを基に、タグやemotionの細分化、複数キャラクターなどへ拡張する。
- 配信形式：node-media-serverでHLS/LL-HLSを有効化し、OBS以外のクライアントへの配信も可能にする。
- 設定テンプレ：モーションカテゴリ、音声プロファイル、TTSエンジン別設定の追加。
