# src/api/

REST API 層。Express ルーターとリクエスト/レスポンススキーマを定義。

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `generation.controller.ts` | `/api/generate` エンドポイント |
| `stream.controller.ts` | `/api/stream` ストリーミングエンドポイント |
| `schema.ts` | リクエストバリデーション用 Zod スキーマ |
| `docs.ts` | Swagger UI セットアップ |

## generation.controller.ts

主要エンドポイント `POST /api/generate`:
- リクエストボディを `generateRequestSchema` でバリデーション
- `stream: true` の場合は NDJSON でストリーミングレスポンス
- `stream: false` の場合は結合済み動画パスを JSON で返却
- APIキー認証をサポート（`X-API-Key` ヘッダー）

## stream.controller.ts

RTMP ストリーミング制御用エンドポイント。

## schema.ts

Zod を使用したリクエストスキーマ定義:
- `generateRequestSchema` - 動画生成リクエスト
- アクション: `start`, `speak`, `idle`
