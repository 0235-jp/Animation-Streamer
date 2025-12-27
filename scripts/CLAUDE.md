# scripts/

Python スクリプト群。リップシンク用の事前処理ツールを格納。

## ファイル構成

| ファイル | 説明 |
|---------|------|
| `detect_mouth_positions.py` | 動画から口位置を検出するCLIスクリプト |
| `requirements.txt` | Python 依存パッケージ |

## 口位置検出スクリプト

`detect_mouth_positions.py` は [MotionPNGTuber](https://github.com/rotejin/MotionPNGTuber) と同じライブラリを使用してアニメ顔の口位置を検出する。

### 使用ライブラリ

- `anime-face-detector` - アニメ顔検出（28点ランドマーク）
- `mmdet` / `mmpose` / `mmcv-full` - 機械学習ベースの検出
- `opencv-python` - 動画処理
- `tqdm` - プログレス表示

### 使用方法

```bash
# 仮想環境のセットアップ
python -m venv venv
source venv/bin/activate

# 依存パッケージのインストール
pip install openmim
mim install mmcv-full==1.7.0
pip install -r scripts/requirements.txt

# 口位置検出の実行
python scripts/detect_mouth_positions.py \
  --input motions/talk_loop.mp4 \
  --output motions/talk_loop.mouth.json
```

### 出力形式

```json
{
  "videoFileName": "talk_loop.mp4",
  "videoWidth": 896,
  "videoHeight": 1152,
  "frameRate": 16,
  "totalFrames": 48,
  "durationSeconds": 3.0,
  "positions": [
    {
      "frameIndex": 0,
      "timeSeconds": 0.0,
      "centerX": 448,
      "centerY": 720,
      "width": 120,
      "height": 60,
      "confidence": 0.95
    }
  ],
  "createdAt": "2025-12-28T10:00:00.000Z"
}
```

出力JSONは `lipSync[].mouthDataPath` で参照される。
