# src/config/

設定ファイルのローダーとスキーマ定義。

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `loader.ts` | 設定ファイルの読み込みと解決処理 |
| `schema.ts` | Zod による設定スキーマ定義 |

## schema.ts

Zod を使用した設定バリデーションスキーマ:

- `configSchema` - トップレベル設定
- `presetSchema` - プリセット定義
- `audioProfileSchema` - TTS エンジン設定（VOICEVOX / Style-Bert-VITS2）
- `sizedMotionSchema` - large/small モーション定義
- `sttConfigSchema` - STT設定
- `sizedLipSyncSchema` - リップシンク設定（large/small 形式、basePath, mouthDataPath, images, overlayConfig）

### TTS エンジン

`discriminatedUnion` で2つのエンジンをサポート:
- `ttsEngine: 'voicevox'` → `voicevoxUrl`, `speakerId` など
- `ttsEngine: 'style-bert-vits2'` → `sbv2Url`, `modelId` など

## loader.ts

- `loadConfig()` - `config/stream-profile.json` を読み込み
- 相対パスを絶対パスに解決
- プリセット内のモーションパスを `motions/` ディレクトリ基準で解決
- 型: `ResolvedConfig`, `ResolvedPreset`
