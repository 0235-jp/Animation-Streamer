# モーション素材作成ガイド

このドキュメントでは、ai-streamer で使用するモーション動画およびリップシンク画像の作成方法について説明します。

## 1. ディレクトリ構成

```
motions/
├── idle.mp4              # 待機モーション
├── idle_talk.mp4         # 待機→発話トランジション
├── talk_idle.mp4         # 発話→待機トランジション
├── talk_large.mp4        # 発話モーション（大）
├── talk_small.mp4        # 発話モーション（小）
└── lip/                  # リップシンク画像（aiueoN形式）
    ├── neutral_A.png     # あ
    ├── neutral_I.png     # い
    ├── neutral_U.png     # う
    ├── neutral_E.png     # え
    ├── neutral_O.png     # お
    ├── neutral_N.png     # ん/無音
    ├── happy_A.png
    └── ...
```

## 2. モーション動画の仕様

### 2.1 推奨フォーマット

| 項目 | 推奨値 |
|------|--------|
| コンテナ | MP4 |
| 映像コーデック | H.264 (libx264) |
| ピクセルフォーマット | yuv420p |
| フレームレート | 24fps または 30fps |
| 解像度 | 統一すること（例: 1080x1920） |
| 音声 | なし（-an） |

### 2.2 仕様統一の重要性

すべてのモーション動画で **解像度・フレームレート・コーデック・ピクセルフォーマット** を統一する必要があります。仕様が異なると動画連結時に問題が発生します。

起動時に自動チェックが行われ、不一致がある場合は変換コマンドが提示されます。

### 2.3 変換コマンド例

```bash
ffmpeg -i input.mp4 -vf "scale=1080:1920,fps=30" -c:v libx264 -pix_fmt yuv420p -an output.mp4
```

## 3. リップシンク画像の仕様

### 3.1 推奨フォーマット

| 項目 | 推奨値 |
|------|--------|
| フォーマット | PNG |
| 解像度 | モーション動画と同じ |
| 背景 | 不透明（透過なし推奨） |

### 3.2 必要な画像

emotion ごとに以下の6種類の画像が必要です（aiueoN形式）。

| ファイル名例 | 形状 | 説明 |
|-------------|------|------|
| neutral_A.png | A - あ | 大きく開いた口 |
| neutral_I.png | I - い | 横に広がった口 |
| neutral_U.png | U - う | すぼめた口 |
| neutral_E.png | E - え | 中間的に開いた口 |
| neutral_O.png | O - お | 丸く開いた口 |
| neutral_N.png | N - ん/無音 | 閉じた口 |

## 4. 口形状の詳細説明（画像生成プロンプト用）

### A - 大きく開いた口（「あ」）

口を大きく縦に開いた状態。顎が下がり、口の中がよく見える。最も開いた口の形。「あー」と発音するときの口。

**英語プロンプト例:**
> Mouth wide open vertically, jaw dropped. Inside of mouth clearly visible. The most open mouth position, as if saying "Ah" sound.

### I - 横に広がった口（「い」）

口を横に広げて開いた状態。口角が左右に引かれ、上下の歯が見える。笑顔に近い口の形。「いー」と発音するときの口。

**英語プロンプト例:**
> Mouth open wide horizontally, corners of lips pulled to the sides. Upper and lower teeth visible. Similar to a smile or saying "Ee" sound.

### U - すぼめた口（「う」）

唇を前に突き出してすぼめた状態。キスをするときのような口。口の開きは小さく、唇が丸く突き出る。「うー」と発音するときの口。

**英語プロンプト例:**
> Lips puckered and pushed forward, small circular opening. Like a kiss or whistle position. As if saying "Oo" sound.

### E - 中間的に開いた口（「え」）

口を中程度に開いた状態。「い」と「あ」の中間のような形。軽く横に広がりつつ、やや開いている。「えー」と発音するときの口。

**英語プロンプト例:**
> Mouth moderately open, slightly wide. Between "Ee" and "Ah" position. Natural speaking expression as if saying "Eh" sound.

### O - 丸く開いた口（「お」）

口をやや丸く開いた状態。唇が少し前に突き出し、縦長の楕円形。「おー」と発音するときの口。Aより開きは小さい。

**英語プロンプト例:**
> Mouth open in a rounded shape, lips slightly pushed forward. Oval-shaped opening, smaller than wide open. As if saying "Oh" sound.

### N - 閉じた口（ん/無音）

口を自然に閉じた状態。力が抜けており、リラックスした閉じ口。発音していないとき、「ん」を発音するとき、子音部分の口。

**英語プロンプト例:**
> Mouth naturally closed, completely relaxed. No tension in lips, neutral resting face. Silent or humming position.

## 5. 画像生成時の注意点

1. **一貫性を保つ**: 同じキャラクターで全ての口形状を生成し、顔の角度・照明・表情（口以外）を統一する

2. **口以外は固定**: 目・眉・髪・体のポーズは全画像で同じにする

3. **解像度を揃える**: すべての画像を同じ解像度で出力する

4. **背景を統一**: 透過PNGより不透明背景を推奨（動画変換時の互換性のため）

5. **emotion別に作成**: neutral, happy, sad など感情ごとに別セットを用意する

## 6. 設定ファイルへの記載

```json
{
  "lipSync": [
    {
      "id": "lip-neutral",
      "emotion": "neutral",
      "images": {
        "A": "lip/neutral_A.png",
        "I": "lip/neutral_I.png",
        "U": "lip/neutral_U.png",
        "E": "lip/neutral_E.png",
        "O": "lip/neutral_O.png",
        "N": "lip/neutral_N.png"
      }
    },
    {
      "id": "lip-happy",
      "emotion": "happy",
      "images": {
        "A": "lip/happy_A.png",
        "I": "lip/happy_I.png",
        "U": "lip/happy_U.png",
        "E": "lip/happy_E.png",
        "O": "lip/happy_O.png",
        "N": "lip/happy_N.png"
      }
    }
  ]
}
```

## 7. 参考資料

- [LipWI2VJs](https://github.com/M-gen/LipWI2VJs) - MFCCベースの音声リップシンク解析
- [wLipSync](https://github.com/mrxz/wLipSync) - MFCCプロファイルデータ / aiueoN形式の参照元
