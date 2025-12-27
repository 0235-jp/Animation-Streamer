#!/usr/bin/env python3
"""
口位置検出スクリプト

動画から各フレームの口位置を検出し、JSONファイルとして出力する。
MotionPNGTuberと同じライブラリ（anime-face-detector）を使用。

Usage:
    python detect_mouth_positions.py --input video.mp4 --output video.mouth.json
"""

import argparse
import json
import os
import sys
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
from tqdm import tqdm

try:
    from anime_face_detector import create_detector
except ImportError:
    print("Error: anime-face-detector is not installed.")
    print("Please run: pip install anime-face-detector")
    sys.exit(1)


# 口のランドマークインデックス（anime-face-detector の 28点ランドマーク）
MOUTH_OUTLINE = [24, 25, 26, 27]


def get_device() -> str:
    """利用可能なデバイスを取得"""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda:0"
    except ImportError:
        pass
    return "cpu"


def extract_mouth_position(
    keypoints: np.ndarray,
    frame_idx: int,
    fps: float,
    confidence_threshold: float = 0.3
) -> Optional[dict]:
    """
    キーポイントから口の位置情報を抽出

    Args:
        keypoints: (28, 3) 形状のランドマーク配列 [x, y, confidence]
        frame_idx: フレーム番号
        fps: フレームレート
        confidence_threshold: 信頼度の閾値

    Returns:
        口位置情報の辞書、または検出失敗時はNone
    """
    mouth_points = keypoints[MOUTH_OUTLINE]  # (4, 3)

    # 信頼度チェック
    avg_confidence = float(np.mean(mouth_points[:, 2]))
    if avg_confidence < confidence_threshold:
        return None

    xs = mouth_points[:, 0]
    ys = mouth_points[:, 1]

    min_x, max_x = float(np.min(xs)), float(np.max(xs))
    min_y, max_y = float(np.min(ys)), float(np.max(ys))

    return {
        "frameIndex": frame_idx,
        "timeSeconds": round(frame_idx / fps, 6),
        "centerX": round((min_x + max_x) / 2, 2),
        "centerY": round((min_y + max_y) / 2, 2),
        "width": round(max_x - min_x, 2),
        "height": round(max_y - min_y, 2),
        "confidence": round(avg_confidence, 4),
    }


def detect_mouth_positions(
    video_path: str,
    model: str = "yolov3",
    scale: float = 1.0,
) -> dict:
    """
    動画から口位置を検出

    Args:
        video_path: 入力動画のパス
        model: 検出モデル名（yolov3 など）
        scale: フレームのスケール係数（1.0 = 等倍）

    Returns:
        口位置データの辞書
    """
    # 動画を開く
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    # メタデータ取得
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"Video: {os.path.basename(video_path)}")
    print(f"Resolution: {width}x{height}, FPS: {fps}, Frames: {total_frames}")

    # 検出器初期化
    device = get_device()
    print(f"Device: {device}")
    print(f"Model: {model}")
    print("Initializing detector...")

    try:
        detector = create_detector(model, device=device)
    except Exception as e:
        print(f"Failed to initialize on {device}, falling back to CPU: {e}")
        detector = create_detector(model, device="cpu")

    positions = []
    last_valid_position = None
    detection_failures = 0

    print("Processing frames...")
    for frame_idx in tqdm(range(total_frames), desc="Detecting mouths"):
        ret, frame = cap.read()
        if not ret:
            break

        # スケール変換
        if scale != 1.0:
            frame = cv2.resize(
                frame,
                None,
                fx=scale,
                fy=scale,
                interpolation=cv2.INTER_LINEAR
            )

        # 顔検出
        try:
            preds = detector(frame)
        except Exception as e:
            print(f"\nFrame {frame_idx}: Detection error: {e}")
            preds = []

        if preds and len(preds) > 0:
            # 最初の顔を使用
            face = preds[0]
            keypoints = face.get("keypoints")

            if keypoints is not None:
                keypoints = np.array(keypoints)

                # スケール補正
                if scale != 1.0:
                    keypoints[:, 0] /= scale
                    keypoints[:, 1] /= scale

                mouth_pos = extract_mouth_position(keypoints, frame_idx, fps)

                if mouth_pos:
                    positions.append(mouth_pos)
                    last_valid_position = mouth_pos
                    continue

        # 検出失敗時は前フレームの値を使用
        detection_failures += 1
        if last_valid_position:
            fallback_pos = last_valid_position.copy()
            fallback_pos["frameIndex"] = frame_idx
            fallback_pos["timeSeconds"] = round(frame_idx / fps, 6)
            fallback_pos["confidence"] = 0.0  # フォールバックであることを示す
            positions.append(fallback_pos)
        else:
            # 最初のフレームで検出失敗した場合はデフォルト値
            positions.append({
                "frameIndex": frame_idx,
                "timeSeconds": round(frame_idx / fps, 6),
                "centerX": width / 2,
                "centerY": height * 0.7,  # 顔の下部を想定
                "width": width * 0.2,
                "height": height * 0.1,
                "confidence": 0.0,
            })

    cap.release()

    success_rate = (total_frames - detection_failures) / total_frames * 100
    print(f"\nDetection complete: {total_frames - detection_failures}/{total_frames} frames ({success_rate:.1f}%)")

    return {
        "videoFileName": os.path.basename(video_path),
        "videoWidth": width,
        "videoHeight": height,
        "frameRate": fps,
        "totalFrames": total_frames,
        "durationSeconds": round(total_frames / fps, 6),
        "positions": positions,
        "createdAt": datetime.now().isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Detect mouth positions from video for lip-sync overlay"
    )
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="Input video file path"
    )
    parser.add_argument(
        "--output", "-o",
        required=True,
        help="Output JSON file path"
    )
    parser.add_argument(
        "--model", "-m",
        default="yolov3",
        help="Detection model (default: yolov3)"
    )
    parser.add_argument(
        "--scale", "-s",
        type=float,
        default=1.0,
        help="Frame scale factor for detection (default: 1.0)"
    )

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: Input file not found: {args.input}")
        sys.exit(1)

    result = detect_mouth_positions(
        args.input,
        model=args.model,
        scale=args.scale,
    )

    # 出力ディレクトリ作成
    output_dir = os.path.dirname(args.output)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Saved: {args.output}")


if __name__ == "__main__":
    main()
