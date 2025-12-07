# Animation Streamer

音声合成(TTS)とモーション動画を組み合わせ、待機状態から発話→待機へシームレスに繋がるクリップを生成するためのローカルAPIサーバーです。

本プロジェクトはアルファ版です。各バージョンでインタフェースが後方互換なく変更される可能性があるためご注意ください。

## 必要環境
- Node.js 20 以上
- ffmpeg / ffprobe
- TTS エンジン (以下のいずれか):
  - VOICEVOX エンジン (ローカルAPI)
  - Style-Bert-VITS2 API サーバー
- (任意) STTサーバー: 音声入力の文字起こし機能を使う場合

## セットアップ
ローカルの場合は `config/example.stream-profile.local.json` を、Docker Composeの場合は `config/example.stream-profile.docker.json` を `config/stream-profile.json` にコピーしてください。

```bash
cp config/example.stream-profile.local.json config/stream-profile.json
npm install
```
モーション素材はプロジェクト直下の `motions/` ディレクトリにまとめて配置し、`config/stream-profile.json` では `talk_idle.mp4` や `dir_name/talk_idle.mp4` のように `motions/` からの相対パス（接頭辞なし）で参照します。まずはサンプルをセットアップしておくと動作確認が容易です。

```bash
mkdir -p motions output
cp example/motion/* motions/
```

`example/motion/` には Anchor のサンプル素材が入っているので、必要に応じて差し替えてください。生成された MP4/WAV は常に `output/` に保存されます。

## 開発サーバー
```bash
npm run dev
```

`http://localhost:4000/docs` で Swagger UI を確認できます。

## Docker での起動
`docker compose` を利用するとローカルの Node.js を汚さずに起動できます。初回は `config/example.stream-profile.docker.json` を `config/stream-profile.json` にコピーし、Compose ではモーション素材 (`./motions:/app/motions:ro`) と出力先 (`./output:/app/output`) をボリュームマウントしてください。加えて `RESPONSE_PATH_BASE=${PWD}/output` を環境変数として渡すことで、コンテナが生成したファイルのホスト側フルパスを API レスポンスで受け取れます。サンプルの `stream-profile.json` もこのディレクトリ構成を前提に、モーションは `talk_idle.mp4` / `foo/talk_idle.mp4` といった `motions/` 内相対パスだけで指定しています。

Compose には VOICEVOX エンジンの `voicevox` サービス（`voicevox/voicevox_engine:cpu-latest`）も含まれており、`http://voicevox:50021` で待ち受けます。`config/stream-profile.json` の `voicevoxUrl` もこのホスト名を参照するようデフォルトで設定しているため、Compose を使わない場合には実行環境に合わせて URL を変更してください。

### 開発用コンテナ (`animation-streamer-dev`)
- ローカルの `src/`・`config/`・`motions/`・`output/` をボリュームマウントした `ts-node` 実行環境です。
- 以下で起動できます。
  ```bash
  docker compose up animation-streamer-dev
  ```
- ソースを編集すると即座に反映されます。`tsconfig.json` や依存関係を変えた場合は `docker compose build animation-streamer-dev` で再ビルドしてください。

### 公開イメージ (`animation-streamer`)
- `ghcr.io/0235-jp/animation-streamer:latest` を利用し、`npm run start` でビルド済み成果物を起動するサービスです。
- イメージ内には設定ファイルやモーション素材・出力先ディレクトリを含めていないため、必ず `config/`・`motions/`・`output/` をボリュームマウントしてください。
  ```bash
  docker compose pull animation-streamer
  docker compose up animation-streamer
  ```
- 生成済みの MP4/WAV は `output/` ボリュームに書き出されます。不要になったファイルはホスト側で削除してください (`RESPONSE_PATH_BASE` を設定していればレスポンスにその絶対パスが返ります)。

両サービスとも `http://localhost:4000` で待ち受けます。`PORT` や `HOST` を変更したい場合は `config/stream-profile.json` の `server` セクションを更新してください。

## API 例
```bash
curl -X POST http://localhost:4000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "stream": false,
    "debug": true,
    "presetId": "anchor-a",
    "requests": [
      { "action": "start" },
      { "action": "speak", "params": { "text": "こんにちは", "emotion": "happy" } },
      { "action": "idle", "params": { "durationMs": 2000 } },
      { "action": "speak", "params": { "text": "さようなら" } }
    ]
  }'
```

`stream=false` の場合は `combined.outputPath` に 1 本にまとめたMP4パスが返却されます。 `stream=true` を指定すると各アクション完了ごとに NDJSON でレスポンスがストリーミングされます。
`presetId` はリクエスト直下で **必須** 指定です（すべてのアクションが同一プリセットを参照します）。
`server.apiKey` を設定した場合は `-H 'X-API-Key: <your-key>'` を付与してください。

## ストリーミング配信 API

RTMP/HTTP-FLV でリアルタイム配信を行う場合は `/api/stream/*` エンドポイントを使用します。

### 配信の開始
```bash
curl -X POST http://localhost:4000/api/stream/start \
  -H 'Content-Type: application/json' \
  -d '{ "presetId": "anchor-a" }'
```

`debug: true` を指定すると `output/stream` 内のファイルを自動削除しません（デバッグ用）。

### テキスト割り込み
配信中に発話を挿入するには `/api/stream/text` を使用します。フォーマットは `/api/generate` と同じです。
```bash
curl -X POST http://localhost:4000/api/stream/text \
  -H 'Content-Type: application/json' \
  -d '{
    "presetId": "anchor-a",
    "requests": [
      { "action": "speak", "params": { "text": "こんにちは" } }
    ]
  }'
```

### 配信の停止
```bash
curl -X POST http://localhost:4000/api/stream/stop
```

### OBS での視聴
OBS のメディアソースに `rtmp://localhost:1935/live/main` を指定してください。`config/stream-profile.json` の `rtmp.outputUrl` でポートやストリームキーを変更できます。


## 設定
`config/stream-profile.json` でモーション動画や VOICEVOX エンドポイントなどを定義します。主な項目は以下の通りです。

- server.port / server.host / server.apiKey: API の待受ポート・ホスト・APIキー。
- rtmp.outputUrl: RTMP 出力先 URL（デフォルト: `rtmp://127.0.0.1:1935/live/main`）。内蔵の node-media-server がこの URL でストリームを受信し、OBS 等から参照可能にします。
- presets: キャラクターのプリセット定義配列。最低1件登録し、APIからは `presetId` で参照します。
  - id / displayName: プリセット識別子と任意の表示名。
  - actions: プリセット固有のカスタムアクション群（`speak`/`idle` は予約語のため不可）。`id` は `requests[].action` に指定し、`path` は `motions/` からの相対パス（例: `talk_idle.mp4` や `dir_name/talk_idle.mp4`）です。
  - idleMotions / speechMotions: 待機・発話モーションのプール。`large`/`small` と emotion ごとに最適なクリップを選択し、`motionId` で直接指定もできます。
  - speechTransitions (任意): `speak` の前後に自動で差し込む導入/締めモーション。emotion が一致しない場合は `neutral` → その他の順でフォールバックします。
  - audioProfile: プリセット単位の TTS 設定。`ttsEngine` で使用するエンジンを指定し、emotion 別の `voices[]` を定義します（最低1件必須）。
  - モーション動画は `motions/` 以下にまとまっている想定です。設定ファイルからは接頭辞なしの `motions/` 内相対パスで参照し、Docker では `./motions:/app/motions:ro` をマウントして同じパス構成を維持します。
- 出力ファイルは常にプロジェクト直下の `output/` に保存されます（設定不要）。Docker では `./output:/app/output` をマウントし、`RESPONSE_PATH_BASE` にホスト側 `output` の絶対パスを渡すことで API レスポンスにホスト上のパスを返せます。

`config/example.stream-profile.docker.json` / `config/example.stream-profile.local.json` には Anchor のサンプルが含まれているので、必要に応じて `presets[]` を増やし、`presetId` を切り替えて利用してください。

## 音声入力 (STT)

`speak` アクションではテキストの代わりに音声ファイルを入力できます。

### 直接音声入力（TTS スキップ）
```bash
curl -X POST http://localhost:4000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "presetId": "anchor-a",
    "requests": [
      { "action": "speak", "params": { "audio": { "path": "/path/to/voice.wav" } } }
    ]
  }'
```

### 音声→文字起こし→TTS（声質変換）
`transcribe: true` を指定すると、入力音声を STT で文字起こしし、TTS で再合成します。
```bash
curl -X POST http://localhost:4000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "presetId": "anchor-a",
    "requests": [
      { "action": "speak", "params": { "audio": { "path": "/path/to/voice.wav", "transcribe": true } } }
    ]
  }'
```

### STT サーバーの設定
音声の文字起こし機能には OpenAI 互換 API をサポートする STT サーバーが必要です。

**推奨: faster-whisper-server**
```bash
docker run -d -p 8000:8000 fedirz/faster-whisper-server:latest
```

設定ファイルの `stt` セクションで接続先を指定します:
```json
{
  "stt": {
    "baseUrl": "http://localhost:8000/v1",
    "model": "whisper-1",
    "language": "ja"
  }
}
```

OpenAI の Whisper API を使う場合:
```json
{
  "stt": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "whisper-1",
    "language": "ja"
  }
}
```

## TTS エンジンの設定

`audioProfile` で使用する TTS エンジンを指定します。`voices` 配列には最低1件の設定が必要です。

### VOICEVOX

```json
{
  "audioProfile": {
    "ttsEngine": "voicevox",
    "voicevoxUrl": "http://127.0.0.1:50021",
    "voices": [
      {
        "emotion": "neutral",
        "speakerId": 1,
        "speedScale": 1.1
      },
      {
        "emotion": "happy",
        "speakerId": 3,
        "pitchScale": 0.3,
        "intonationScale": 1.2
      }
    ]
  }
}
```

**voices のパラメータ:**
- `emotion` (必須): 感情ラベル。リクエストの `emotion` と照合
- `speakerId` (必須): VOICEVOX の話者 ID
- `speedScale`, `pitchScale`, `intonationScale`, `volumeScale`: 音声調整パラメータ
- `outputSamplingRate`, `outputStereo`: 出力形式

### Style-Bert-VITS2

```json
{
  "audioProfile": {
    "ttsEngine": "style-bert-vits2",
    "sbv2Url": "http://127.0.0.1:5000",
    "voices": [
      {
        "emotion": "neutral",
        "modelId": 0,
        "speakerId": 0,
        "style": "Neutral",
        "styleWeight": 1.0,
        "sdpRatio": 0.2,
        "noise": 0.6,
        "noisew": 0.8,
        "length": 1.0,
        "language": "JP"
      },
      {
        "emotion": "happy",
        "modelId": 0,
        "speakerId": 0,
        "style": "Happy",
        "styleWeight": 1.2
      }
    ]
  }
}
```

**voices のパラメータ:**
- `emotion` (必須): 感情ラベル
- `modelId` / `modelName`: 使用モデルの指定
- `speakerId` / `speakerName`: 話者の指定
- `style`, `styleWeight`: スタイル指定と強度
- `sdpRatio`, `noise`, `noisew`: 音声のランダム性調整
- `length`: 話速（1.0 が基準）
- `language`: 言語（`JP`, `EN`, `ZH` など）

Style-Bert-VITS2 サーバーの起動:
```bash
python server_fastapi.py
```

## モーション動画の仕様統一

モーション動画を連結する際、すべてのファイルで **解像度・フレームレート・コーデック・ピクセルフォーマット** が統一されている必要があります。仕様が異なるファイルが混在すると、動画が途中で固まったり乱れたりする原因になります。

起動時に自動で仕様チェックが行われ、不一致がある場合は警告ログと推奨変換コマンドが出力されます。

```text
⚠️  モーション仕様の不一致を検出

--- モーション仕様一覧 ---

[896x1152 16/1fps h264 yuv420p] ← 推奨基準 (最多)
  - idle-a-large
  - idle-a-small

[1920x1080 24000/1001fps h264 yuv420p]
  - talk-a-large

--- 推奨変換コマンド ---
ffmpeg -i "talk_large.mp4" -vf "scale=896:1152,fps=16" -c:v libx264 -pix_fmt yuv420p -an "talk_large_converted.mp4"
```

多数決で推奨基準が決定され、変換が必要なファイルのコマンドが自動生成されます。
