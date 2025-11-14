# Animation Streamer 実装計画書

**作成日**: 2025-11-14
**目的**: 設計書に記載されているが未実装の API (status/start/stop/text) とストリーミング機能の実装計画

---

## 📋 現状分析

### ✅ 実装済み機能
- **POST /api/generate** - speak/idle/任意アクションのクリップ生成
- **GET /health** - ヘルスチェック
- **GET /docs/** - API ドキュメント
- **GenerationService** - クリップ生成ロジック
- **MediaPipeline** - ffmpeg 連携・音声/動画合成
- **ClipPlanner** - Large/Small モーション選択ロジック
- **VoicevoxClient** - VOICEVOX 音声合成

### ❌ 未実装機能
以下の機能が設計書に記載されているが未実装：

1. **POST /api/start** - RTMP ストリーミング開始
2. **POST /api/stop** - RTMP ストリーミング停止
3. **POST /api/text** - テキスト入力からリアルタイム音声生成
4. **GET /api/status** - 現在のストリーム状態取得
5. **StreamService / StreamSession** - ストリーミング状態管理
6. **IdleLoopController** - 待機モーションループ制御
7. **SpeechTaskQueue** - 発話タスクキュー管理
8. **RTMP サーバー統合** - node-media-server による配信

---

## 🎯 実装計画

### Phase 1: 基盤整備（最小限の動作確認）

#### 1.1 型定義の作成
**ファイル**: `src/types/stream.ts`

```typescript
export interface StreamState {
  sessionId: string
  phase: 'IDLE' | 'WAITING' | 'SPEECH' | 'STOPPED'
  activeMotionId?: string
  queueLength: number
  uptimeMs?: number
}

export interface StartRequest {
  sessionToken?: string
}

export interface StartResponse {
  status: string
  sessionId: string
  currentMotionId?: string
}

export interface StopResponse {
  status: string
}

export interface TextRequest {
  text: string
  motionId?: string
  metadata?: Record<string, unknown>
}

export interface StatusResponse {
  status: string
  currentMotionId?: string
  queueLength: number
  uptimeMs: number
}
```

**参照**: `docs/detailed-design.md`:90-99, 216-250

---

#### 1.2 IdleLoopController の実装
**ファイル**: `src/services/idle-loop.controller.ts`

**役割**:
- 複数の待機モーションを ffmpeg の `concat` デマルチプレクサでループ再生
- RTMP/HTTP-FLV でストリーム配信
- stdin でプレイリストを動的に供給

**主要メソッド**:
```typescript
class IdleLoopController {
  start(): Promise<void>
  stop(): Promise<void>
  getCurrentMotionId(): string | undefined
  reserveNextClip(clipPath: string): Promise<void> // Phase 3 で実装
}
```

**実装方針**:
- Phase 1 では単一モーションの無限ループを実装（ランダム切り替えは Phase 2）
- ffmpeg コマンド例: `ffmpeg -re -f concat -safe 0 -i pipe:0 -c copy -f flv rtmp://127.0.0.1:1935/live/main`
- stdin に `file '<path>'\n` を書き込んでプレイリスト供給
- ProcessManager または child_process.spawn を使用

**参照**: `docs/detailed-design.md`:102-109, `docs/overview.md`:43

---

#### 1.3 StreamService の実装
**ファイル**: `src/services/stream.service.ts`

**役割**:
- ストリーミング状態管理（状態遷移ロジック）
- IdleLoopController と SpeechTaskQueue の調整
- ミューテックス（AsyncLock）による API 呼び出しの競合防止

**状態遷移**:
```
IDLE --start--> WAITING --text--> SPEECH --(speech done)--> WAITING
WAITING --stop--> STOPPED
SPEECH --stop--> STOPPED
STOPPED --start--> WAITING
```

**主要メソッド**:
```typescript
class StreamService {
  start(request: StartRequest): Promise<StartResponse>
  stop(): Promise<StopResponse>
  getStatus(): StatusResponse
  enqueueText(request: TextRequest): Promise<void> // Phase 3 で実装
}
```

**実装方針**:
- Phase 1 では start/stop/getStatus のみ実装
- `async-lock` または独自 mutex で状態遷移の排他制御
- sessionId は UUID で生成
- 起動時刻を記録して uptimeMs を計算

**参照**: `docs/detailed-design.md`:90-100, `docs/overview.md`:42

---

#### 1.4 StreamController の実装
**ファイル**: `src/api/stream.controller.ts`

**実装するエンドポイント**:

##### POST /api/start
- リクエスト: `{ sessionToken?: string }`
- レスポンス: `{ status: "WAITING", sessionId: "...", currentMotionId: "..." }`
- 処理: `StreamService.start()` を呼び出し

##### POST /api/stop
- リクエスト: `{}`
- レスポンス: `{ status: "STOPPED" }`
- 処理: `StreamService.stop()` を呼び出し

##### GET /api/status
- レスポンス: `{ status: "WAITING", currentMotionId: "...", queueLength: 0, uptimeMs: 12345 }`
- 処理: `StreamService.getStatus()` を呼び出し

##### POST /api/text
- リクエスト: `{ text: string, motionId?: string, metadata?: object }`
- レスポンス: `{ "message": "Not Implemented" }` (status 501)
- 処理: Phase 3 まで未実装

**実装例**:
```typescript
export const createStreamRouter = (streamService: StreamService): Router => {
  const router = Router()

  router.post('/start', async (req, res) => { /* ... */ })
  router.post('/stop', async (req, res) => { /* ... */ })
  router.get('/status', (req, res) => { /* ... */ })
  router.post('/text', (req, res) => {
    res.status(501).json({ message: 'Not Implemented' })
  })

  return router
}
```

**参照**: `docs/detailed-design.md`:216-250

---

#### 1.5 RTMP サーバーの統合
**ファイル**: `src/infra/media-server.ts` (新規作成)

**役割**:
- `node-media-server` のラッパー
- RTMP/HTTP-FLV サーバーの起動・停止

**実装方針**:
```typescript
import NodeMediaServer from 'node-media-server'

export class MediaServer {
  private nms: NodeMediaServer

  constructor(config: { rtmpPort: number, httpPort: number }) {
    this.nms = new NodeMediaServer({
      rtmp: { port: config.rtmpPort, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
      http: { port: config.httpPort, allow_origin: '*' }
    })
  }

  start(): Promise<void>
  stop(): Promise<void>
}
```

**設定例** (`config/stream-profile.json` に追加):
```json
{
  "rtmp": {
    "outputUrl": "rtmp://127.0.0.1:1935/live/main",
    "port": 1935,
    "httpPort": 8000
  }
}
```

**参照**: `docs/overview.md`:18, `docs/detailed-design.md`:46

---

#### 1.6 app.ts の統合
**ファイル**: `src/app.ts`

**追加内容**:
```typescript
import { MediaServer } from './infra/media-server'
import { IdleLoopController } from './services/idle-loop.controller'
import { StreamService } from './services/stream.service'
import { createStreamRouter } from './api/stream.controller'

export const createApp = async (options: CreateAppOptions = {}) => {
  // ... 既存のコード ...

  const mediaServer = new MediaServer({
    rtmpPort: config.rtmp.port,
    httpPort: config.rtmp.httpPort
  })
  await mediaServer.start()

  const idleLoopController = new IdleLoopController({
    idleMotions: config.idleMotions,
    outputUrl: config.rtmp.outputUrl
  })

  const streamService = new StreamService({
    config,
    idleLoopController
  })

  // ... Express 設定 ...
  app.use('/api', createStreamRouter(streamService))

  return { app, config, mediaServer }
}
```

---

#### 1.7 動作確認
**確認項目**:
1. サーバー起動: `npm run dev`
2. RTMP サーバーが起動していることを確認
3. `POST /api/start` でストリーミング開始
4. `GET /api/status` でステータス取得
5. OBS で `rtmp://localhost:1935/live/main` を受信できることを確認
6. `POST /api/stop` でストリーミング停止

---

### Phase 2: 待機ループの強化

#### 2.1 IdleLoopController のランダム切り替え実装
**実装内容**:
- 複数の待機モーションからランダムに選択
- 現在再生中のモーション終了予定時刻を計算
- 終了の少し前（例: 500ms前）に次のモーションを stdin に書き込み
- フレーム落ちを防ぐためのバッファリング戦略

**参考ロジック**:
```typescript
private async supplyNextMotion() {
  const motion = this.selectRandomMotion()
  const entry = `file '${motion.path}'\n`
  this.ffmpegProcess.stdin?.write(entry)

  // モーション長を取得して次の供給タイミングをスケジュール
  const durationMs = await this.getMotionDuration(motion.path)
  setTimeout(() => this.supplyNextMotion(), durationMs - 500)
}
```

**参照**: `docs/detailed-design.md`:102-109

---

#### 2.2 シームレスな接続のテスト
**テスト項目**:
- 待機モーション間の切り替えでフレーム落ちがないこと
- OBS で受信した映像が途切れないこと
- 複数のモーション（3種類以上）がランダムに再生されること

---

### Phase 3: テキスト入力対応（将来実装）

#### 3.1 SpeechTaskQueue の実装
**ファイル**: `src/services/speech-queue.ts`

**役割**:
- `/api/text` からのテキスト入力を FIFO 管理
- TTS 音声生成（prepare phase）
- 待機ループへの発話モーション挿入（playback phase）

**主要メソッド**:
```typescript
class SpeechTaskQueue {
  enqueue(task: SpeechTask): Promise<void>
  private async prepareSpeech(task: SpeechTask): Promise<PreparedClip>
  private async playSpeech(clip: PreparedClip): Promise<void>
}
```

**処理フロー**:
1. テキスト受信 → キューに追加
2. VOICEVOX で音声合成（並列実行可）
3. MediaPipeline で音声 + モーション合成
4. FIFO 順で `IdleLoopController.reserveNextClip()` を呼び出し
5. 待機モーション終了後に発話モーションを差し込み
6. 発話終了後、待機モーションに戻る

**参照**: `docs/detailed-design.md`:111-118

---

#### 3.2 IdleLoopController の割り込み機能
**追加メソッド**:
```typescript
async reserveNextClip(clipPath: string): Promise<void> {
  // 現在の待機モーション供給を一時停止
  this.pauseIdleMotions()

  // 発話モーションを次のエントリとして書き込み
  this.ffmpegProcess.stdin?.write(`file '${clipPath}'\n`)

  // 発話モーション終了後に待機モーション供給を再開
  setTimeout(() => this.resumeIdleMotions(), clipDuration)
}
```

---

#### 3.3 StreamService への統合
**追加内容**:
```typescript
class StreamService {
  async enqueueText(request: TextRequest): Promise<void> {
    if (this.state.phase === 'STOPPED' || this.state.phase === 'IDLE') {
      throw new Error('Stream not started')
    }

    await this.speechQueue.enqueue({
      text: request.text,
      motionId: request.motionId,
      metadata: request.metadata
    })

    this.state.phase = 'SPEECH'
    this.state.queueLength = this.speechQueue.getLength()
  }
}
```

---

#### 3.4 /api/text エンドポイントの実装
**変更内容**:
```typescript
router.post('/text', async (req, res) => {
  try {
    const request = textRequestSchema.parse(req.body)
    await streamService.enqueueText(request)
    res.json({ message: 'Enqueued', queueLength: streamService.getStatus().queueLength })
  } catch (error) {
    // エラーハンドリング
  }
})
```

---

### Phase 4: ドキュメント整備

#### 4.1 OpenAPI 仕様書の更新
**ファイル**: `docs/openapi.yaml`

**追加するパス**:
- `/api/start`
- `/api/stop`
- `/api/status`
- `/api/text`

**追加するスキーマ**:
- `StartRequest`
- `StartResponse`
- `StopResponse`
- `StatusResponse`
- `TextRequest`
- `TextResponse`

---

#### 4.2 エラーハンドリングの強化
**実装項目**:
- 409 Conflict: 状態的に矛盾する操作（例: STOPPED 時に stop を呼ぶ）
- 500 Internal Server Error: ffmpeg プロセス異常終了
- タイムアウト処理: ffmpeg プロセスが応答しない場合の SIGKILL

**参照**: `docs/detailed-design.md`:251-260

---

#### 4.3 テストコードの作成
**テストファイル**:
- `tests/api/stream.controller.test.ts`
- `tests/services/stream.service.test.ts`
- `tests/services/idle-loop.controller.test.ts`
- `tests/services/speech-queue.test.ts`

**テスト項目**:
- 状態遷移の正当性
- 競合状態のハンドリング
- ffmpeg プロセスの起動・停止
- エラーケース

---

## 📊 優先順位と工数見積もり

| Phase | 内容 | 優先度 | 見積工数 | 依存関係 |
|-------|------|--------|----------|----------|
| Phase 1 | 基盤整備 | 最高 | 3-5日 | なし |
| Phase 2 | 待機ループ強化 | 高 | 1-2日 | Phase 1 |
| Phase 3 | テキスト入力 | 中 | 3-4日 | Phase 1, 2 |
| Phase 4 | ドキュメント整備 | 中 | 1-2日 | 並行可 |

**合計見積もり**: 8-13日

---

## 🔧 技術的な注意点

### 1. ffmpeg プロセス管理
- stdin への書き込みはノンブロッキングで行う
- プロセスが予期せず終了した場合の再起動ロジック
- SIGTERM → SIGKILL のタイムアウト設定（5秒推奨）

### 2. 状態管理
- `async-lock` などのライブラリで排他制御
- 状態遷移の原子性を保証
- ログ出力で状態遷移を追跡可能にする

### 3. RTMP ストリーミング
- `node-media-server` の設定で gop_cache を有効化
- OBS 側でバッファリング設定を調整
- ネットワーク遅延を考慮した再生遅延の設定

### 4. メモリリーク対策
- 一時ファイルの定期的なクリーンアップ
- ffmpeg プロセスのメモリ使用量監視
- `CleanupService` の活用

---

## 📚 参考資料

- 設計書: `docs/detailed-design.md`
- 概要設計: `docs/overview.md`
- OpenAPI 仕様: `docs/openapi.yaml`
- 既存実装: `src/services/generation.service.ts`

---

## 🚀 次のアクション

1. **Phase 1 の実装開始**を推奨
2. 最初に `src/types/stream.ts` を作成
3. 次に `IdleLoopController` の最小実装（単一モーションループ）
4. `StreamService` と `StreamController` を実装
5. 動作確認（OBS でストリーム受信）

---

**最終更新**: 2025-11-14
