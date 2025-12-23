# Animation Streamer

音声合成(TTS)とモーション動画を組み合わせ、発話アニメーションクリップを生成するローカルAPIサーバー。

## 技術スタック

- **言語**: TypeScript (CommonJS)
- **ランタイム**: Node.js 20+
- **フレームワーク**: Express 5
- **テスト**: Vitest
- **外部ツール**: ffmpeg / ffprobe
- **TTS エンジン**: VOICEVOX または Style-Bert-VITS2

## ディレクトリ構造

```
src/
├── api/           # REST API コントローラー、スキーマ
├── config/        # 設定ファイルのローダー・スキーマ
├── infra/         # RTMPサーバーなどインフラ層
├── services/      # ビジネスロジック (TTS, 動画生成, キャッシュ等)
├── types/         # 型定義
├── utils/         # ロガー、プロセスユーティリティ
├── app.ts         # Express アプリケーション初期化
└── server.ts      # エントリポイント
config/            # 設定ファイル (stream-profile.json)
motions/           # モーション動画素材
output/            # 生成された動画・音声の出力先
docs/              # 設計ドキュメント、OpenAPI仕様
tests/             # テストファイル
```

## 開発コマンド

```bash
npm run dev      # 開発サーバー起動 (ts-node)
npm run build    # TypeScript ビルド
npm run start    # ビルド済みJSを実行
npm test         # テスト実行 (vitest run)
```

## 設定

- `config/stream-profile.json` がメイン設定ファイル
- `config/example.stream-profile.*.json` をコピーして作成
- サーバー設定、TTS設定、プリセット定義を含む

## API

- `POST /api/generate` - アニメーション動画生成
- Swagger UI: `http://localhost:4000/docs`
- OpenAPI仕様: `docs/openapi.yaml`

## 主要サービス

- `generation.service.ts` - 動画生成のメインロジック
- `stream.service.ts` - ストリーミング処理
- `media-pipeline.ts` - ffmpeg を使った動画処理パイプライン
- `voicevox.ts` / `style-bert-vits2.ts` - TTS エンジン連携
- `cache.service.ts` - 動画キャッシュ管理
- `clip-planner.ts` - クリップ計画

## 作業フロー

### 1. 要件確認フェーズ
- ユーザーの指示をもとに修正内容をまとめる
- 疑問点がなくなるまでユーザーに確認する
- 不明点があれば必ず質問し、推測で進めない

### 2. 計画書作成
- 修正内容をプロジェクトルートに `CHANGES.md` として書き出す
- 変更対象ファイル、影響範囲、作業手順を明記する

### 3. 設計書更新
- `docs/` 内の関連設計ドキュメントを先に更新する
- コード変更前に設計を確定させる

### 4. 実装
- develop ブランチから作業ブランチを作成する
- コードを変更する
- 関連ファイルも忘れず更新する:
  - `config/` 内の設定ファイル
  - `README.md`
  - `docs/openapi.yaml`（API変更時）

### 5. テスト
- 必要に応じてテストを追加・更新する
- `npm test` を実行して全テストがパスすることを確認する

### 6. ドキュメント整備
- 各フォルダの `CLAUDE.md` を最新の状態に更新する

### 7. 完了報告
- 変更内容をユーザーに報告する
- **コミット・プッシュはユーザーの明示的な指示があるまで行わない**

### 8. コミット（指示があった場合のみ）
- `CHANGES.md` を削除する
- 変更内容をコミットする
- コミットメッセージは変更内容を簡潔に記述する

### GitHub操作
- GitHub関連の操作は積極的に `gh` コマンドを活用する
- Issue作成、PR作成、ラベル付けなどは `gh` で行う
