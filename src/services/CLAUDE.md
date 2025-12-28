# src/services/

ビジネスロジック層。動画生成、TTS、キャッシュなどのコア機能を実装。

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `generation.service.ts` | 動画生成のメインサービス |
| `media-pipeline.ts` | ffmpeg を使った動画処理パイプライン |
| `clip-planner.ts` | クリップ計画・シーケンス構築 |
| `cache.service.ts` | 動画キャッシュ管理 |
| `stream.service.ts` | RTMP ストリーミング処理 |
| `voicevox.ts` | VOICEVOX TTS クライアント |
| `style-bert-vits2.ts` | Style-Bert-VITS2 TTS クライアント |
| `stt.ts` | STT (音声認識) クライアント |
| `idle-loop.controller.ts` | 待機ループ制御 |
| `lip-sync/` | リップシンク機能モジュール |

## generation.service.ts

`GenerationService` クラス:
- `processBatch()` - リクエストバッチを処理
- アクション: `start`, `speak`, `speakLipSync`, `idle`
- TTS で音声生成 → クリップ計画 → 動画生成 → 結合
- ストリーミング/非ストリーミング両対応

## media-pipeline.ts

`MediaPipeline` クラス:
- ffmpeg/ffprobe を使用した動画処理
- クリップの切り出し、結合、音声ミキシング
- `ClipSource` 型でクリップ情報を管理

## clip-planner.ts

`ClipPlanner` クラス:
- 音声長に基づくモーションクリップのシーケンス計画
- large/small モーションの選択ロジック
- トランジション（enter/exit）の挿入

## cache.service.ts

`CacheService` クラス:
- 生成済み動画のハッシュベースキャッシュ
- speak/idle/combined それぞれのキャッシュキー生成
- `cache: true` リクエストで有効化

## TTS クライアント

- `voicevox.ts` - VOICEVOX API (`/audio_query`, `/synthesis`)
- `style-bert-vits2.ts` - Style-Bert-VITS2 API (`/voice`)
- 両者とも感情(emotion)による話者切り替えをサポート
