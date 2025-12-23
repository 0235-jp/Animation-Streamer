# src/utils/

ユーティリティ関数。

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `logger.ts` | ロガー設定 |
| `process.ts` | プロセス実行ユーティリティ |

## logger.ts

`pino` を使用したロガー。
- 開発時は `pino-pretty` でフォーマット
- `logger.info()`, `logger.error()`, `logger.warn()` など

## process.ts

外部プロセス実行ユーティリティ:
- ffmpeg/ffprobe の実行をラップ
- エラーハンドリング
