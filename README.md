# Animation Streamer

音声合成(TTS)とモーション動画を組み合わせ、待機状態から発話→待機へシームレスに繋がるクリップを生成するためのローカルAPIサーバーです。

## 必要環境
- Node.js 20 以上
- ffmpeg / ffprobe
- VOICEVOX エンジン (ローカルAPI)

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
  - actions: キャラクター固有のカスタムアクション群（`speak`/`idle` は予約語のため不可）。`id` は `requests[].action` に指定し、`path` は `motions/` からの相対パス（例: `talk_idle.mp4` や `dir_name/talk_idle.mp4`）です。
  - idleMotions / speechMotions: 待機・発話モーションのプール。`large`/`small` と emotion ごとに最適なクリップを選択し、`motionId` で直接指定もできます。
  - speechTransitions (任意): `speak` の前後に自動で差し込む導入/締めモーション。emotion が一致しない場合は `neutral` → その他の順でフォールバックします。
  - audioProfile: キャラクター単位の VOICEVOX 接続設定。`voicevoxUrl` や話者 ID、emotion 別の `voices[]` を定義できます。
  - モーション動画は `motions/` 以下にまとまっている想定です。設定ファイルからは接頭辞なしの `motions/` 内相対パスで参照し、Docker では `./motions:/app/motions:ro` をマウントして同じパス構成を維持します。
- 出力ファイルは常にプロジェクト直下の `output/` に保存されます（設定不要）。Docker では `./output:/app/output` をマウントし、`RESPONSE_PATH_BASE` にホスト側 `output` の絶対パスを渡すことで API レスポンスにホスト上のパスを返せます。

`config/example.stream-profile.docker.json` / `config/example.stream-profile.local.json` には Anchor のサンプルが含まれているので、必要に応じて `characters[]` を増やし、`characterId` を切り替えて利用してください。
