# speakLipSync機能 設計書

## 概要

VOICEVOXの`audio_query`APIからモーラごとの正確なタイミング情報を取得し、音素レベルで同期したリップシンク動画を生成する新しいアクション。

## 背景

既存の`speak`アクションは、モーション動画（mp4）を音声の長さに合わせて連結するため、口の動きが音声の内容（発音）とは同期していない。`speakLipSync`は、口の形の画像（PNG）を音素レベルで切り替えることで、より自然なリップシンクを実現する。

## 既存speakとの違い

| 項目 | speak（既存） | speakLipSync（新規） |
|------|--------------|---------------------|
| 素材 | モーション動画（mp4） | 全身画像（png）× 7枚/emotion |
| 口の動き | 動画に含まれる（固定） | 音声に合わせて画像切り替え |
| 同期精度 | 音声の長さのみ | 音素レベルで同期 |
| TTS対応 | VOICEVOX / Style-Bert-VITS2 | VOICEVOXのみ |

## 対応範囲

| 入力 | TTS | 対応 |
|------|-----|------|
| text | VOICEVOX | ✅ 対応 |
| text | Style-Bert-VITS2 | ❌ エラー |
| audio + transcribe: true | VOICEVOX | ✅ 対応 |
| audio + transcribe: true | Style-Bert-VITS2 | ❌ エラー |
| audio + transcribe: false | - | ❌ エラー |

### 非対応の理由

- **Style-Bert-VITS2**: モーラごとのタイミング情報を取得するAPIが存在しない
- **audio + transcribe: false**: 音声から正確な音素タイミングを取得できない

## エラー条件

```typescript
// speakLipSync実行時のバリデーション

// 1. Style-Bert-VITS2は非対応
if (audioProfile.ttsEngine === 'style-bert-vits2') {
  throw new Error('speakLipSyncはVOICEVOXのみ対応しています')
}

// 2. 直接音声使用は非対応
if (params.audio && !params.audio.transcribe) {
  throw new Error('speakLipSyncは直接音声使用（transcribe: false）に対応していません')
}

// 3. lipSync設定がない
if (!preset.lipSync || preset.lipSync.length === 0) {
  throw new Error('lipSync設定がありません')
}
```

## 入力パターン別フロー

### パターン1: text入力 ✅

```
text "こんにちは"
        ↓
VOICEVOX audio_query → モーラ情報（タイミング含む）
        ↓
VOICEVOX synthesis → 音声
        ↓
モーラ情報 → ビゼムタイムライン
        ↓
画像切り替え + 音声 → 出力
```

### パターン2: audio + transcribe: true ✅

```
入力音声
        ↓
STT → text "こんにちは"
        ↓
VOICEVOX audio_query → モーラ情報
        ↓
VOICEVOX synthesis → 新しい音声（キャラ声）
        ↓
モーラ情報 → ビゼムタイムライン
        ↓
画像切り替え + 新しい音声 → 出力
```

### パターン3: audio + transcribe: false ❌

```
→ エラー: "speakLipSyncは直接音声使用（transcribe: false）に対応していません"
```

### パターン4: Style-Bert-VITS2使用時 ❌

```
→ エラー: "speakLipSyncはVOICEVOXのみ対応しています"
```

## 全体フロー図

```
                        speakLipSync
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
              バリデーション      バリデーション
              TTS = VOICEVOX?     transcribe: false?
                    │                 │
                 No ↓              Yes ↓
                  エラー            エラー
                    │
                 Yes ↓
     ┌──────────────┴──────────────┐
     ▼                             ▼
  text入力                  audio+transcribe:true
     │                             │
     │                         入力音声
     │                             │
     │                             ▼
     │                        STT → text
     │                             │
     └──────────────┬──────────────┘
                    ▼
         VOICEVOX audio_query → モーラ情報
                    ↓
         VOICEVOX synthesis → 音声
                    ↓
         モーラ情報 → ビゼムタイムライン
         [o: 0-150ms][N: 150-250ms][i: 250-370ms]...
                    ↓
         emotion → lipSync配列から画像セット選択
                    ↓
         タイムラインに従って画像切り替え → 動画生成（ffmpeg）
                    ↓
                出力MP4
```

## VOICEVOXのaudio_query活用

```
テキスト → VOICEVOX audio_query API
                ↓
{
  "accent_phrases": [
    {
      "moras": [
        { "text": "コ", "vowel": "o", "vowel_length": 0.15 },
        { "text": "ン", "vowel": "N", "vowel_length": 0.10 },
        { "text": "ニ", "vowel": "i", "vowel_length": 0.12 },
        { "text": "チ", "vowel": "i", "vowel_length": 0.11 },
        { "text": "ワ", "vowel": "a", "vowel_length": 0.18 }
      ]
    }
  ]
}
                ↓
正確なビゼムタイムライン生成
```

## VOICEVOX母音→ビゼムマッピング

```typescript
const VOWEL_TO_VISEME: Record<string, string> = {
  'a': 'a',
  'i': 'i',
  'u': 'u',
  'e': 'e',
  'o': 'o',
  'N': 'N',       // ん
  'cl': 'closed', // 促音（っ）
  'pau': 'closed' // ポーズ
}
```

## 設定構造

```jsonc
{
  "presets": [
    {
      "id": "anchor-a",

      // 既存（変更なし）
      "idleMotions": { ... },
      "speechMotions": { ... },
      "speechTransitions": { ... },

      // VOICEVOXのみspeakLipSync対応
      "audioProfile": {
        "ttsEngine": "voicevox",
        "voicevoxUrl": "http://127.0.0.1:50021",
        "voices": [
          { "emotion": "neutral", "speakerId": 1 },
          { "emotion": "happy", "speakerId": 1, "pitchScale": 0.05 }
        ]
      },

      // 新規追加
      "lipSync": [
        {
          "id": "lip-neutral",
          "emotion": "neutral",
          "images": {
            "a": "lip/neutral_a.png",
            "i": "lip/neutral_i.png",
            "u": "lip/neutral_u.png",
            "e": "lip/neutral_e.png",
            "o": "lip/neutral_o.png",
            "N": "lip/neutral_n.png",
            "closed": "lip/neutral_closed.png"
          }
        },
        {
          "id": "lip-happy",
          "emotion": "happy",
          "images": {
            "a": "lip/happy_a.png",
            "i": "lip/happy_i.png",
            "u": "lip/happy_u.png",
            "e": "lip/happy_e.png",
            "o": "lip/happy_o.png",
            "N": "lip/happy_n.png",
            "closed": "lip/happy_closed.png"
          }
        }
      ]
    }
  ]
}
```

## スキーマ定義（追加分）

```typescript
// src/config/schema.ts

const lipSyncImagesSchema = z.object({
  a: z.string().min(1),       // あ
  i: z.string().min(1),       // い
  u: z.string().min(1),       // う
  e: z.string().min(1),       // え
  o: z.string().min(1),       // お
  N: z.string().min(1),       // ん
  closed: z.string().min(1),  // 閉じ
})

const lipSyncVariantSchema = z.object({
  id: z.string().min(1),
  emotion: z.string().min(1).default('neutral'),
  images: lipSyncImagesSchema,
})

// presetSchemaに追加
const presetSchema = z.object({
  // ...既存
  lipSync: z.array(lipSyncVariantSchema).optional(),
})
```

## 型定義（追加分）

```typescript
// src/types/generate.ts

export interface SpeakLipSyncParams {
  text?: string
  audio?: AudioInput
  emotion?: string
}

// VOICEVOX audio_queryのモーラ情報
export interface VoicevoxMora {
  text: string
  vowel: string
  vowel_length: number
  pitch: number
}

// ビゼムタイムライン
export interface VisemeSegment {
  viseme: 'a' | 'i' | 'u' | 'e' | 'o' | 'N' | 'closed'
  startMs: number
  endMs: number
}
```

## APIリクエスト例

### 成功するリクエスト

```jsonc
POST /api/generate
{
  "presetId": "anchor-a",
  "cache": true,
  "requests": [
    // ✅ テキスト入力（VOICEVOX）
    {
      "action": "speakLipSync",
      "params": {
        "text": "こんにちは",
        "emotion": "happy"
      }
    },

    // ✅ 音声入力（STT→TTS、キャラ声に変換）
    {
      "action": "speakLipSync",
      "params": {
        "audio": { "path": "/path/to/audio.wav", "transcribe": true },
        "emotion": "neutral"
      }
    }
  ]
}
```

### エラーになるリクエスト

```jsonc
// ❌ transcribe: false
{
  "action": "speakLipSync",
  "params": {
    "audio": { "path": "/path/to/audio.wav", "transcribe": false }
  }
}
// → Error: "speakLipSyncは直接音声使用（transcribe: false）に対応していません"

// ❌ Style-Bert-VITS2のプリセットで使用
{
  "action": "speakLipSync",
  "params": { "text": "こんにちは" }
}
// → Error: "speakLipSyncはVOICEVOXのみ対応しています"
```

## 実装ファイル構成

```
src/
├── config/
│   └── schema.ts              # lipSyncスキーマ追加
├── types/
│   └── generate.ts            # SpeakLipSyncParams, VisemeSegment追加
└── services/
    ├── voicevox.ts            # audio_query拡張（モーラ情報返却）
    ├── generation.service.ts  # speakLipSyncアクション追加
    └── lip-sync/
        ├── index.ts
        ├── timeline-generator.ts  # モーラ→ビゼムタイムライン変換
        └── video-composer.ts      # 画像切り替え→動画生成
```

## 素材ディレクトリ構成

```
motions/
└── anchor-a/
    └── lip/
        ├── neutral_a.png       # 全身画像（あ・neutral）
        ├── neutral_i.png
        ├── neutral_u.png
        ├── neutral_e.png
        ├── neutral_o.png
        ├── neutral_n.png
        ├── neutral_closed.png
        ├── happy_a.png         # 全身画像（あ・happy）
        └── ...
```

## 注意事項

| 項目 | 内容 |
|------|------|
| TTS制限 | VOICEVOXのみ対応。SBV2はエラー |
| 音声直接使用 | `transcribe: false`は非対応。エラー |
| STT設定 | `audio + transcribe: true`使用時は必須 |
| emotion | lipSync配列に該当がない場合は`neutral`にフォールバック |
| lipSync設定 | 未設定の場合はエラー |

## 将来の拡張可能性

- **Style-Bert-VITS2対応**: APIにモーラタイミング情報が追加されれば対応可能
- **フォルマント解析**: 音声から直接母音を検出する方式を追加すれば`transcribe: false`にも対応可能
- **多言語対応**: 日本語以外の言語用ビゼムマッピングを追加
