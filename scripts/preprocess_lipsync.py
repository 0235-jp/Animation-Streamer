#!/usr/bin/env python3
"""
リップシンク用前処理スクリプト

動画から口位置を検出し、口を消した動画とJSONデータを出力する。
MotionPNGTuber同等のホモグラフィ変換・平面フィッティング陰影補正を実装。

出力:
    - <入力>.mouth.json: 口位置データ
    - <入力>_mouthless.mp4: 口を消した動画

使用例:
    python preprocess_lipsync.py input.mp4
    python preprocess_lipsync.py input.mp4 -o output_prefix
"""

import argparse
import json
import math
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
except ImportError:
    print("Error: mediapipe がインストールされていません")
    print("  pip install mediapipe opencv-python numpy")
    sys.exit(1)


# モデルファイルのURL
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
MODEL_FILENAME = "face_landmarker.task"

# mediapipe FaceLandmarker の口関連ランドマークインデックス
MOUTH_OUTER_INDICES = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    409, 270, 269, 267, 0, 37, 39, 40, 185
]
MOUTH_LEFT = 61
MOUTH_RIGHT = 291
MOUTH_TOP = 13
MOUTH_BOTTOM = 14

# 目のランドマーク（回転角度計算用）
LEFT_EYE_OUTER = 33
RIGHT_EYE_OUTER = 263

# 正規化パッチのサイズ
NORM_PATCH_SIZE = 256


def download_model(model_dir: Path) -> Path:
    """モデルファイルをダウンロード"""
    model_path = model_dir / MODEL_FILENAME
    if model_path.exists():
        return model_path

    print(f"モデルをダウンロード中: {MODEL_URL}")
    model_dir.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(MODEL_URL, model_path)
    print(f"モデルを保存しました: {model_path}")
    return model_path


# ============================================
# 口位置検出
# ============================================

def one_pole_beta(cutoff_hz: float, fps: float) -> float:
    """EMAフィルタの係数を計算"""
    if cutoff_hz <= 0 or fps <= 0:
        return 0.0
    rc = 1.0 / (2.0 * np.pi * cutoff_hz)
    dt = 1.0 / fps
    return dt / (rc + dt)


def smooth_positions_zero_phase(
    positions: list[dict],
    fps: float,
    cutoff_hz: float = 3.0,
) -> list[dict]:
    """Zero-phase EMA平滑化を適用"""
    if len(positions) < 2 or cutoff_hz <= 0:
        return positions

    beta = one_pole_beta(cutoff_hz, fps)
    if beta <= 0 or beta >= 1:
        return positions

    valid_indices = [i for i, p in enumerate(positions) if p["confidence"] > 0]
    if len(valid_indices) < 2:
        return positions

    keys = ["centerX", "centerY", "width", "height", "rotation"]
    smoothed = [p.copy() for p in positions]

    for key in keys:
        values = np.array([positions[i][key] for i in valid_indices], dtype=np.float64)

        forward = np.zeros_like(values)
        forward[0] = values[0]
        for i in range(1, len(values)):
            forward[i] = beta * values[i] + (1 - beta) * forward[i - 1]

        backward = np.zeros_like(values)
        backward[-1] = forward[-1]
        for i in range(len(values) - 2, -1, -1):
            backward[i] = beta * forward[i] + (1 - beta) * backward[i + 1]

        for j, idx in enumerate(valid_indices):
            smoothed[idx][key] = float(backward[j])

    return smoothed


def interpolate_invalid_positions(positions: list[dict]) -> list[dict]:
    """検出失敗フレームを線形補間で埋める"""
    if not positions:
        return positions

    result = [p.copy() for p in positions]
    valid_indices = [i for i, p in enumerate(positions) if p["confidence"] > 0]

    if len(valid_indices) == 0:
        return result

    keys = ["centerX", "centerY", "width", "height", "rotation"]

    for i, pos in enumerate(result):
        if pos["confidence"] > 0:
            continue

        prev_idx = None
        next_idx = None

        for vi in valid_indices:
            if vi < i:
                prev_idx = vi
            elif vi > i and next_idx is None:
                next_idx = vi
                break

        if prev_idx is not None and next_idx is not None:
            t = (i - prev_idx) / (next_idx - prev_idx)
            for key in keys:
                v0 = positions[prev_idx][key]
                v1 = positions[next_idx][key]
                result[i][key] = v0 + t * (v1 - v0)
            result[i]["confidence"] = 0.5
        elif prev_idx is not None:
            for key in keys:
                result[i][key] = positions[prev_idx][key]
            result[i]["confidence"] = 0.3
        elif next_idx is not None:
            for key in keys:
                result[i][key] = positions[next_idx][key]
            result[i]["confidence"] = 0.3

    return result


def calculate_face_rotation(
    landmarks: list,
    frame_width: int,
    frame_height: int,
) -> float:
    """目のランドマークから顔の回転角度を計算"""
    left_eye = landmarks[LEFT_EYE_OUTER]
    right_eye = landmarks[RIGHT_EYE_OUTER]

    dx = (right_eye.x - left_eye.x) * frame_width
    dy = (right_eye.y - left_eye.y) * frame_height

    angle = math.degrees(math.atan2(dy, dx))
    return angle


def extract_mouth_from_landmarks(
    landmarks: list,
    frame_width: int,
    frame_height: int,
    pad: float = 0.3,
) -> Optional[dict]:
    """mediapipe FaceLandmarker のランドマークから口の位置・サイズ・回転を抽出"""
    mouth_points = []
    for idx in MOUTH_OUTER_INDICES:
        lm = landmarks[idx]
        x = lm.x * frame_width
        y = lm.y * frame_height
        mouth_points.append((x, y))

    mouth_points = np.array(mouth_points)

    center_x = float(np.mean(mouth_points[:, 0]))
    center_y = float(np.mean(mouth_points[:, 1]))

    left = landmarks[MOUTH_LEFT]
    right = landmarks[MOUTH_RIGHT]
    top = landmarks[MOUTH_TOP]
    bottom = landmarks[MOUTH_BOTTOM]

    width = abs(right.x - left.x) * frame_width
    height = abs(bottom.y - top.y) * frame_height

    width = width * (1 + pad)
    height = height * (1 + pad)

    min_width = frame_width * 0.05
    min_height = frame_height * 0.03
    width = max(width, min_width)
    height = max(height, min_height)

    rotation = calculate_face_rotation(landmarks, frame_width, frame_height)

    return {
        "centerX": center_x,
        "centerY": center_y,
        "width": width,
        "height": height,
        "rotation": rotation,
    }


# ============================================
# ホモグラフィ変換・口消し処理
# ============================================

def get_quad_from_position(
    pos: dict,
    scale: float = 1.0,
) -> np.ndarray:
    """
    口位置データから4点のquad座標を生成
    回転を考慮した矩形の4隅を返す

    Returns:
        shape (4, 2) の配列: [左上, 右上, 右下, 左下]
    """
    cx = pos["centerX"]
    cy = pos["centerY"]
    w = pos["width"] * scale
    h = w  # 正方形として扱う
    rotation = pos.get("rotation", 0)

    # 回転角度をラジアンに
    angle_rad = math.radians(rotation)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    # 中心からの相対座標（回転前）
    half_w = w / 2
    half_h = h / 2

    corners = [
        (-half_w, -half_h),  # 左上
        (half_w, -half_h),   # 右上
        (half_w, half_h),    # 右下
        (-half_w, half_h),   # 左下
    ]

    # 回転を適用して絶対座標に変換
    quad = []
    for dx, dy in corners:
        rx = dx * cos_a - dy * sin_a
        ry = dx * sin_a + dy * cos_a
        quad.append([cx + rx, cy + ry])

    return np.array(quad, dtype=np.float32)


def get_norm_corners(size: int) -> np.ndarray:
    """正規化空間の4隅座標を返す"""
    return np.array([
        [0, 0],
        [size - 1, 0],
        [size - 1, size - 1],
        [0, size - 1],
    ], dtype=np.float32)


def warp_to_norm(
    frame: np.ndarray,
    quad: np.ndarray,
    norm_size: int = NORM_PATCH_SIZE,
) -> tuple[np.ndarray, np.ndarray]:
    """
    フレームからquad領域を正規化空間にワープ

    Returns:
        (正規化パッチ, ホモグラフィ行列)
    """
    norm_corners = get_norm_corners(norm_size)
    M = cv2.getPerspectiveTransform(quad, norm_corners)
    warped = cv2.warpPerspective(frame, M, (norm_size, norm_size))
    return warped, M


def warp_from_norm(
    patch: np.ndarray,
    quad: np.ndarray,
    output_size: tuple[int, int],
    norm_size: int = NORM_PATCH_SIZE,
    feather_px: int = 20,
) -> tuple[np.ndarray, np.ndarray]:
    """
    正規化パッチをフレーム空間にワープ

    Returns:
        (ワープされたパッチ, マスク)
    """
    norm_corners = get_norm_corners(norm_size)
    M = cv2.getPerspectiveTransform(norm_corners, quad)

    h, w = output_size
    warped = cv2.warpPerspective(patch, M, (w, h))

    # フェザリング付きマスクを作成（ワープ前に適用）
    mask = np.ones((norm_size, norm_size), dtype=np.float32)

    # 境界をフェードアウト
    for i in range(feather_px):
        alpha = i / feather_px
        # 上下左右の境界をフェード
        mask[i, :] = np.minimum(mask[i, :], alpha)
        mask[norm_size - 1 - i, :] = np.minimum(mask[norm_size - 1 - i, :], alpha)
        mask[:, i] = np.minimum(mask[:, i], alpha)
        mask[:, norm_size - 1 - i] = np.minimum(mask[:, norm_size - 1 - i], alpha)

    # ガウシアンぼかしで滑らかに
    mask = cv2.GaussianBlur(mask, (feather_px * 2 + 1, feather_px * 2 + 1), 0)

    # マスクをワープ
    warped_mask = cv2.warpPerspective(mask, M, (w, h))

    # 0-255 に変換
    warped_mask = (warped_mask * 255).astype(np.uint8)

    return warped, warped_mask


def create_ellipse_mask_with_clip(
    size: int,
    scale_x: float = 0.6,
    scale_y: float = 0.5,
    top_clip_frac: float = 0.8,
    feather_px: int = 15,
) -> np.ndarray:
    """
    楕円形のマスクを生成（上部クリップ付き、鼻保護用）

    Args:
        size: マスクサイズ（正方形）
        scale_x: X軸方向のスケール
        scale_y: Y軸方向のスケール
        top_clip_frac: 上部クリップ比率（鼻を保護）
        feather_px: フェザリングピクセル数
    """
    mask = np.zeros((size, size), dtype=np.float32)

    cx = size // 2
    cy = size // 2

    rx = int(size * scale_x / 2)
    ry = int(size * scale_y / 2)

    # 楕円を描画
    cv2.ellipse(mask, (cx, cy), (rx, ry), 0, 0, 360, 1.0, -1)

    # 上部をクリップ（鼻保護）
    clip_y = int(cy - ry * top_clip_frac)
    if clip_y > 0:
        mask[:clip_y, :] = 0

    # フェザリング
    if feather_px > 0:
        ksize = feather_px * 2 + 1
        mask = cv2.GaussianBlur(mask, (ksize, ksize), 0)

    return mask


def create_ring_mask(
    inner_mask: np.ndarray,
    ring_width: int = 20,
) -> np.ndarray:
    """
    内側マスクから環状マスクを生成（周辺参照領域用）
    """
    # 内側マスクを膨張
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (ring_width * 2 + 1, ring_width * 2 + 1)
    )
    dilated = cv2.dilate((inner_mask * 255).astype(np.uint8), kernel)
    outer_mask = dilated.astype(np.float32) / 255.0

    # 環状マスク = 外側 - 内側
    ring = np.clip(outer_mask - inner_mask, 0, 1)

    return ring


class PlaneFitter:
    """
    平面フィッティングによる陰影推定
    環状領域の明度から平面を推定し、内側領域に適用
    """

    def __init__(self, ring_mask: np.ndarray, inner_mask: np.ndarray):
        """
        Args:
            ring_mask: 環状マスク（参照領域）
            inner_mask: 内側マスク（適用領域）
        """
        self.h, self.w = ring_mask.shape

        # 環状領域のピクセル座標を取得
        ring_ys, ring_xs = np.where(ring_mask > 0.5)

        if len(ring_xs) < 10:
            self.valid = False
            return

        self.valid = True

        # 座標を正規化 (-1 to 1)
        self.ring_xs_norm = (ring_xs / self.w) * 2 - 1
        self.ring_ys_norm = (ring_ys / self.h) * 2 - 1
        self.ring_xs = ring_xs
        self.ring_ys = ring_ys

        # 最小二乗法用の行列を構築 [x, y, 1]
        A = np.column_stack([
            self.ring_xs_norm,
            self.ring_ys_norm,
            np.ones(len(ring_xs))
        ])

        # 擬逆行列を事前計算
        self.pinvA = np.linalg.pinv(A)

        # メッシュグリッドを事前計算（全領域用）
        ys, xs = np.mgrid[0:self.h, 0:self.w]
        self.xs_norm = (xs / self.w) * 2 - 1
        self.ys_norm = (ys / self.h) * 2 - 1

        self.inner_mask = inner_mask

    def estimate_plane(self, l_channel: np.ndarray) -> np.ndarray:
        """
        LAB L チャンネルから平面を推定

        Returns:
            平面マップ（同サイズ）
        """
        if not self.valid:
            return np.zeros((self.h, self.w), dtype=np.float32)

        # 環状領域のL値を取得
        ring_l = l_channel[self.ring_ys, self.ring_xs]

        # 平面係数を推定 [a, b, c]
        coeffs = self.pinvA @ ring_l

        # 全領域で平面を評価
        plane = (
            coeffs[0] * self.xs_norm +
            coeffs[1] * self.ys_norm +
            coeffs[2]
        )

        return plane.astype(np.float32)


def apply_plane_shading(
    clean_patch: np.ndarray,
    target_patch: np.ndarray,
    plane_fitter: PlaneFitter,
    inner_mask: np.ndarray,
) -> np.ndarray:
    """
    平面フィッティングによる陰影補正を適用

    Args:
        clean_patch: クリーンパッチ（参照）
        target_patch: ターゲットパッチ（現在フレーム）
        plane_fitter: 平面フィッター
        inner_mask: 内側マスク

    Returns:
        陰影補正されたクリーンパッチ
    """
    if not plane_fitter.valid:
        return clean_patch

    # LAB色空間に変換
    clean_lab = cv2.cvtColor(clean_patch, cv2.COLOR_BGR2LAB).astype(np.float32)
    target_lab = cv2.cvtColor(target_patch, cv2.COLOR_BGR2LAB).astype(np.float32)

    # 各パッチの平面を推定
    clean_plane = plane_fitter.estimate_plane(clean_lab[:, :, 0])
    target_plane = plane_fitter.estimate_plane(target_lab[:, :, 0])

    # 平面の差分を計算
    plane_diff = target_plane - clean_plane

    # クリーンパッチのL値に差分を適用
    corrected_l = clean_lab[:, :, 0] + plane_diff * inner_mask
    clean_lab[:, :, 0] = np.clip(corrected_l, 0, 255)

    # 色相も周辺から補正
    ring_mask = create_ring_mask(inner_mask, 10)
    ring_sum = ring_mask.sum() + 1e-6

    for ch in [1, 2]:  # a, b チャンネル
        clean_mean = (clean_lab[:, :, ch] * ring_mask).sum() / ring_sum
        target_mean = (target_lab[:, :, ch] * ring_mask).sum() / ring_sum
        diff = target_mean - clean_mean
        clean_lab[:, :, ch] = np.clip(
            clean_lab[:, :, ch] + diff * inner_mask, 0, 255
        )

    corrected = cv2.cvtColor(clean_lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
    return corrected


def calculate_quality_score(
    result_patch: np.ndarray,
    target_patch: np.ndarray,
    inner_mask: np.ndarray,
    ring_mask: np.ndarray,
) -> float:
    """
    品質スコアを計算（低いほど良い）

    評価項目:
    - 内側と環状領域の明度差
    - 内側領域の勾配エネルギー
    """
    result_lab = cv2.cvtColor(result_patch, cv2.COLOR_BGR2LAB).astype(np.float32)
    target_lab = cv2.cvtColor(target_patch, cv2.COLOR_BGR2LAB).astype(np.float32)

    result_l = result_lab[:, :, 0]
    target_l = target_lab[:, :, 0]

    inner_sum = inner_mask.sum() + 1e-6
    ring_sum = ring_mask.sum() + 1e-6

    # 明度差
    inner_mean = (result_l * inner_mask).sum() / inner_sum
    ring_mean = (target_l * ring_mask).sum() / ring_sum
    luminance_diff = abs(inner_mean - ring_mean)

    # 勾配エネルギー
    gray = cv2.cvtColor(result_patch, cv2.COLOR_BGR2GRAY).astype(np.float32)
    sobel_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    gradient = np.sqrt(sobel_x ** 2 + sobel_y ** 2)
    gradient_energy = (gradient * inner_mask).sum() / inner_sum

    # 総合スコア
    score = luminance_diff + 0.2 * gradient_energy

    return score


def find_best_reference_frame(
    frames: list[np.ndarray],
    positions: list[dict],
    coverage: float = 0.6,
    sample_count: int = 20,
) -> int:
    """
    最適な参照フレームを探す（口が閉じていて品質が高いフレーム）

    Args:
        frames: フレームのリスト
        positions: 口位置データのリスト
        coverage: マスクのカバレッジ
        sample_count: サンプル数

    Returns:
        最適なフレームインデックス
    """
    total_frames = len(frames)
    step = max(1, total_frames // sample_count)

    best_frame = 0
    best_score = float("inf")

    # マスクスケールを計算
    scale_x = 0.50 + 0.18 * coverage
    scale_y = 0.44 + 0.14 * coverage

    for i in range(0, total_frames, step):
        pos = positions[i]
        if pos["confidence"] < 0.5:
            continue

        frame = frames[i]

        # 口の高さが小さい（閉じている）ことを優先
        height_penalty = pos["height"]

        # 正規化空間でパッチを取得
        quad = get_quad_from_position(pos, scale=1.2)
        try:
            norm_patch, _ = warp_to_norm(frame, quad, NORM_PATCH_SIZE)
        except cv2.error:
            continue

        # マスク生成
        inner_mask = create_ellipse_mask_with_clip(
            NORM_PATCH_SIZE, scale_x, scale_y, 0.8, 15
        )

        # 勾配エネルギー（低いほど良い＝テクスチャが少ない）
        gray = cv2.cvtColor(norm_patch, cv2.COLOR_BGR2GRAY).astype(np.float32)
        sobel_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        sobel_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        gradient = np.sqrt(sobel_x ** 2 + sobel_y ** 2)
        inner_sum = inner_mask.sum() + 1e-6
        gradient_energy = (gradient * inner_mask).sum() / inner_sum

        # 内側の明度分散（低いほど良い＝均一）
        lab = cv2.cvtColor(norm_patch, cv2.COLOR_BGR2LAB).astype(np.float32)
        l_values = lab[:, :, 0][inner_mask > 0.5]
        variance = np.var(l_values) if len(l_values) > 0 else 0

        # 総合スコア
        score = height_penalty * 0.1 + gradient_energy * 0.5 + variance * 0.01

        if score < best_score:
            best_score = score
            best_frame = i

    return best_frame


def create_clean_patch_with_inpaint(
    frame: np.ndarray,
    pos: dict,
    coverage: float = 0.6,
    inpaint_radius: int = 5,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, PlaneFitter]:
    """
    参照フレームからクリーンパッチを生成

    Returns:
        (クリーンパッチ, 内側マスク, 環状マスク, 平面フィッター)
    """
    # マスクスケールを計算
    scale_x = 0.50 + 0.18 * coverage
    scale_y = 0.44 + 0.14 * coverage
    ring_px = int(16 + 10 * coverage)

    # quad を取得して正規化空間にワープ
    quad = get_quad_from_position(pos, scale=1.2)
    norm_patch, _ = warp_to_norm(frame, quad, NORM_PATCH_SIZE)

    # マスク生成
    inner_mask = create_ellipse_mask_with_clip(
        NORM_PATCH_SIZE, scale_x, scale_y, 0.8, 15
    )
    ring_mask = create_ring_mask(inner_mask, ring_px)

    # インペインティング用マスク（バイナリ）
    inpaint_mask = (inner_mask * 255).astype(np.uint8)

    # インペインティング
    clean_patch = cv2.inpaint(
        norm_patch, inpaint_mask, inpaint_radius, cv2.INPAINT_TELEA
    )

    # 平面フィッターを作成
    plane_fitter = PlaneFitter(ring_mask, inner_mask)

    return clean_patch, inner_mask, ring_mask, plane_fitter


def erase_mouth_in_frame(
    frame: np.ndarray,
    pos: dict,
    clean_patch: np.ndarray,
    inner_mask: np.ndarray,
    ring_mask: np.ndarray,
    plane_fitter: PlaneFitter,
    ref_pos: dict,
) -> np.ndarray:
    """
    フレームから口を消去

    Args:
        frame: 入力フレーム
        pos: このフレームの口位置
        clean_patch: 参照フレームのクリーンパッチ
        inner_mask: 内側マスク
        ring_mask: 環状マスク
        plane_fitter: 平面フィッター
        ref_pos: 参照フレームの口位置

    Returns:
        口を消去したフレーム
    """
    h, w = frame.shape[:2]

    # このフレームのquadを取得
    quad = get_quad_from_position(pos, scale=1.2)

    # フレームを正規化空間にワープ
    try:
        norm_patch, _ = warp_to_norm(frame, quad, NORM_PATCH_SIZE)
    except cv2.error:
        return frame

    # 陰影補正を適用
    corrected_patch = apply_plane_shading(
        clean_patch, norm_patch, plane_fitter, inner_mask
    )

    # ブレンド（正規化空間で）
    mask_3ch = np.stack([inner_mask] * 3, axis=-1)
    blended_norm = (
        corrected_patch * mask_3ch +
        norm_patch * (1 - mask_3ch)
    ).astype(np.uint8)

    # 正規化空間からフレーム空間に戻す
    warped_result, warped_mask = warp_from_norm(
        blended_norm, quad, (h, w), NORM_PATCH_SIZE
    )

    # 元のフレームとブレンド
    result = frame.copy()
    warped_mask_3ch = np.stack([warped_mask] * 3, axis=-1).astype(np.float32) / 255.0
    result = (
        warped_result * warped_mask_3ch +
        result * (1 - warped_mask_3ch)
    ).astype(np.uint8)

    return result


# ============================================
# メイン処理
# ============================================

def process_video(
    video_path: str,
    output_json: str,
    output_video: str,
    stride: int = 1,
    pad: float = 0.3,
    smooth_cutoff: float = 3.0,
    min_detection_confidence: float = 0.5,
    min_tracking_confidence: float = 0.5,
    coverage: float = 0.6,
    inpaint_radius: int = 5,
    debug_output: Optional[str] = None,
) -> dict:
    """
    動画を処理して口位置JSONと口消し動画を生成

    Args:
        video_path: 入力動画パス
        output_json: 出力JSONパス
        output_video: 出力動画パス（口消し）
        stride: フレームスキップ間隔
        pad: 口周辺のパディング係数（検出用）
        smooth_cutoff: 平滑化のカットオフ周波数 (Hz)
        min_detection_confidence: 顔検出の最小信頼度
        min_tracking_confidence: 顔トラッキングの最小信頼度
        coverage: 口消し領域のカバレッジ (0.0-1.0)
        inpaint_radius: インペインティング半径
        debug_output: デバッグ動画の出力パス

    Returns:
        MouthPositionData形式の辞書
    """
    # モデルをダウンロード
    script_dir = Path(__file__).parent
    model_path = download_model(script_dir / "models")

    # 動画を開く
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"動画を開けません: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"動画情報: {width}x{height} @ {fps:.2f}fps, {total_frames}フレーム")

    # FaceLandmarker を初期化
    base_options = mp_python.BaseOptions(model_asset_path=str(model_path))
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=min_detection_confidence,
        min_tracking_confidence=min_tracking_confidence,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    print("mediapipe FaceLandmarker を初期化しました")

    # ========== パス1: 口位置を検出 ==========
    print("\n[パス1] 口位置を検出中...")

    positions = []
    frames_cache = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frames_cache.append(frame.copy())

        time_seconds = frame_idx / fps
        timestamp_ms = int(frame_idx * 1000 / fps)

        position = {
            "frameIndex": frame_idx,
            "timeSeconds": round(time_seconds, 4),
            "centerX": width / 2,
            "centerY": height * 0.7,
            "width": width * 0.2,
            "height": height * 0.1,
            "confidence": 0.0,
            "rotation": 0.0,
        }

        if frame_idx % stride == 0:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.face_landmarks and len(result.face_landmarks) > 0:
                face_landmarks = result.face_landmarks[0]

                mouth = extract_mouth_from_landmarks(
                    face_landmarks, width, height, pad
                )

                if mouth:
                    position.update(mouth)
                    position["confidence"] = 1.0

        positions.append(position)
        frame_idx += 1

        if frame_idx % 100 == 0:
            print(f"  検出中: {frame_idx}/{total_frames} フレーム")

    landmarker.close()

    print(f"  検出完了: {frame_idx} フレーム")

    valid_count = sum(1 for p in positions if p["confidence"] > 0)
    print(f"  検出成功率: {valid_count}/{len(positions)} ({100*valid_count/len(positions):.1f}%)")

    # 無効フレームを補間
    positions = interpolate_invalid_positions(positions)

    # 平滑化
    if smooth_cutoff > 0:
        print(f"  平滑化を適用 (cutoff={smooth_cutoff}Hz)")
        positions = smooth_positions_zero_phase(positions, fps, smooth_cutoff)

    # ========== パス2: 口消し動画を生成 ==========
    print("\n[パス2] 口消し動画を生成中...")
    print(f"  coverage: {coverage}")

    # 最適な参照フレームを探す
    ref_frame_idx = find_best_reference_frame(frames_cache, positions, coverage)
    print(f"  参照フレーム: {ref_frame_idx}")

    ref_frame = frames_cache[ref_frame_idx]
    ref_pos = positions[ref_frame_idx]

    # クリーンパッチを生成
    clean_patch, inner_mask, ring_mask, plane_fitter = create_clean_patch_with_inpaint(
        ref_frame, ref_pos, coverage, inpaint_radius
    )

    # 出力動画の設定
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out_writer = cv2.VideoWriter(output_video, fourcc, fps, (width, height))

    debug_writer = None
    if debug_output:
        debug_writer = cv2.VideoWriter(debug_output, fourcc, fps, (width, height))

    for i, frame in enumerate(frames_cache):
        pos = positions[i]

        if pos["confidence"] > 0:
            result_frame = erase_mouth_in_frame(
                frame, pos,
                clean_patch, inner_mask, ring_mask, plane_fitter,
                ref_pos
            )
        else:
            result_frame = frame

        out_writer.write(result_frame)

        if debug_writer:
            debug_frame = result_frame.copy()
            quad = get_quad_from_position(pos, scale=1.2)
            quad_int = quad.astype(np.int32)
            cv2.polylines(debug_frame, [quad_int], True, (0, 255, 0), 2)
            cx, cy = int(pos["centerX"]), int(pos["centerY"])
            cv2.circle(debug_frame, (cx, cy), 3, (0, 0, 255), -1)
            cv2.putText(
                debug_frame,
                f"Frame: {i}",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                2,
            )
            debug_writer.write(debug_frame)

        if i % 100 == 0:
            print(f"  口消し中: {i}/{len(frames_cache)} フレーム")

    out_writer.release()
    if debug_writer:
        debug_writer.release()

    print(f"  口消し完了")

    # ========== 結果を出力 ==========
    result = {
        "videoFileName": Path(video_path).name,
        "videoWidth": width,
        "videoHeight": height,
        "frameRate": fps,
        "totalFrames": len(positions),
        "durationSeconds": round(len(positions) / fps, 4),
        "positions": positions,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n出力:")
    print(f"  JSON: {output_json}")
    print(f"  動画: {output_video}")

    return result


def main():
    parser = argparse.ArgumentParser(
        description="リップシンク用前処理（口位置検出 + 口消し動画生成）"
    )
    parser.add_argument("video", help="入力動画ファイル")
    parser.add_argument(
        "-o", "--output",
        help="出力プレフィックス（デフォルト: 入力ファイル名）",
    )
    parser.add_argument(
        "--stride",
        type=int,
        default=1,
        help="フレームスキップ間隔（デフォルト: 1=全フレーム）",
    )
    parser.add_argument(
        "--pad",
        type=float,
        default=0.3,
        help="口周辺のパディング係数（デフォルト: 0.3）",
    )
    parser.add_argument(
        "--smooth-cutoff",
        type=float,
        default=3.0,
        help="平滑化カットオフ周波数 Hz（デフォルト: 3.0、0で無効）",
    )
    parser.add_argument(
        "--min-detection-confidence",
        type=float,
        default=0.5,
        help="顔検出の最小信頼度（デフォルト: 0.5）",
    )
    parser.add_argument(
        "--min-tracking-confidence",
        type=float,
        default=0.5,
        help="顔トラッキングの最小信頼度（デフォルト: 0.5）",
    )
    parser.add_argument(
        "--coverage",
        type=float,
        default=0.6,
        help="口消し領域のカバレッジ 0.0-1.0（デフォルト: 0.6）",
    )
    parser.add_argument(
        "--inpaint-radius",
        type=int,
        default=5,
        help="インペインティング半径（デフォルト: 5）",
    )
    parser.add_argument(
        "--debug-output",
        help="デバッグ動画の出力パス",
    )

    args = parser.parse_args()

    video_path = Path(args.video)
    if not video_path.exists():
        print(f"エラー: 動画ファイルが見つかりません: {video_path}")
        sys.exit(1)

    # 出力パスを決定
    if args.output:
        output_prefix = Path(args.output)
    else:
        output_prefix = video_path.with_suffix("")

    output_json = str(output_prefix) + ".mouth.json"
    output_video = str(output_prefix) + "_mouthless.mp4"

    print(f"入力: {video_path}")
    print(f"出力JSON: {output_json}")
    print(f"出力動画: {output_video}")

    process_video(
        str(video_path),
        output_json,
        output_video,
        stride=args.stride,
        pad=args.pad,
        smooth_cutoff=args.smooth_cutoff,
        min_detection_confidence=args.min_detection_confidence,
        min_tracking_confidence=args.min_tracking_confidence,
        coverage=args.coverage,
        inpaint_radius=args.inpaint_radius,
        debug_output=args.debug_output,
    )

    print("\n完了!")


if __name__ == "__main__":
    main()
