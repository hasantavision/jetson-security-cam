#!/usr/bin/env python3
"""
Benchmark: Native TRT engine vs ORT TRT EP
==========================================
Compares load time, inference latency, and detection output parity.

Usage:
    python3 benchmark_yolo.py [--image PATH] [--runs N] [--warmup N]
"""

import argparse
import sys
import time
from pathlib import Path
from statistics import median, mean, stdev

import cv2
import numpy as np

MODELS_DIR  = Path(__file__).parent.parent / "models"
ENGINE_PATH = MODELS_DIR / "yolox_s_body_head_hand_post_0299_0.4983_1x3x256x320_fp16.engine"
ONNX_PATH   = MODELS_DIR / "yolox_s_body_head_hand_post_0299_0.4983_1x3x256x320_ir8.onnx"

sys.path.insert(0, str(Path(__file__).parent))
from yolox_trt import YOLOXBodyHeadHand, _preprocess, _postprocess, _normalise


def _load_trt(score_th: float):
    if not ENGINE_PATH.exists():
        print(f"[SKIP] Native TRT engine not found: {ENGINE_PATH}")
        return None
    t0 = time.perf_counter()
    m  = YOLOXBodyHeadHand(str(ENGINE_PATH), score_threshold=score_th)
    print(f"  Load time : {(time.perf_counter()-t0)*1000:.0f} ms")
    return m


def _load_ort(score_th: float):
    if not ONNX_PATH.exists():
        print(f"[SKIP] ONNX not found: {ONNX_PATH}")
        return None
    t0 = time.perf_counter()
    m  = YOLOXBodyHeadHand(str(ONNX_PATH), score_threshold=score_th)
    print(f"  Load time : {(time.perf_counter()-t0)*1000:.0f} ms")
    return m


def _run_bench(model, frame: np.ndarray, warmup: int, runs: int):
    """Returns (latencies_ms, last_detections)."""
    # Warm-up (fills CUDA caches, JIT pipelines)
    for _ in range(warmup):
        model.infer(frame)

    times = []
    dets  = []
    for _ in range(runs):
        t0  = time.perf_counter()
        d   = model.infer(frame)
        times.append((time.perf_counter() - t0) * 1000)
        dets = d
    return times, dets


def _det_str(dets: list) -> str:
    if not dets:
        return "(none)"
    return "  ".join(
        f"{d['label']}@{d['score']:.2f}[{d['x1']:.2f},{d['y1']:.2f},{d['x2']:.2f},{d['y2']:.2f}]"
        for d in dets
    )


def _dets_match(a: list, b: list, tol: float = 0.02) -> bool:
    """True if both backends returned equivalent detections (within coord tolerance)."""
    if len(a) != len(b):
        return False
    # Sort by score descending for stable comparison
    sa = sorted(a, key=lambda d: (-d["score"], d["classid"]))
    sb = sorted(b, key=lambda d: (-d["score"], d["classid"]))
    for da, db in zip(sa, sb):
        if da["classid"] != db["classid"]:
            return False
        if abs(da["score"] - db["score"]) > tol:
            return False
        for k in ("x1", "y1", "x2", "y2"):
            if abs(da[k] - db[k]) > tol:
                return False
    return True


def _print_stats(label: str, times) -> None:
    print(f"  Median  : {median(times):.1f} ms")
    print(f"  Mean    : {mean(times):.1f} ms")
    print(f"  Stdev   : {stdev(times):.1f} ms  (n={len(times)})")
    print(f"  Min/Max : {min(times):.1f} / {max(times):.1f} ms")
    print(f"  Est FPS : {1000/median(times):.1f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image",    default=str(Path(__file__).parent.parent / "tests" / "fixtures" / "person.jpg"))
    ap.add_argument("--runs",     type=int, default=30)
    ap.add_argument("--warmup",   type=int, default=5)
    ap.add_argument("--threshold",type=float, default=0.40)
    args = ap.parse_args()

    img = cv2.imread(args.image)
    if img is None:
        # Fallback: random noise frame (320×256 BGR)
        print(f"[WARN] Cannot read {args.image} — using random noise frame")
        img = np.random.randint(0, 255, (256, 320, 3), dtype=np.uint8)
    else:
        print(f"Test image: {args.image}  ({img.shape[1]}×{img.shape[0]})")

    print(f"Runs: {args.runs}  Warm-up: {args.warmup}  Threshold: {args.threshold}\n")

    # ── Native TRT ───────────────────────────────────────────────────────────
    print("=" * 54)
    print("Backend A — Native TRT (.engine)")
    print("=" * 54)
    trt_model = _load_trt(args.threshold)
    trt_times, trt_dets = ([], [])
    if trt_model:
        trt_times, trt_dets = _run_bench(trt_model, img, args.warmup, args.runs)
        _print_stats("TRT", trt_times)
        print(f"  Detections: {_det_str(trt_dets)}")
    print()

    # ── ORT TRT EP ───────────────────────────────────────────────────────────
    print("=" * 54)
    print("Backend B — ORT TRT EP (.onnx + cached engine)")
    print("=" * 54)
    ort_model = _load_ort(args.threshold)
    ort_times, ort_dets = ([], [])
    if ort_model:
        ort_times, ort_dets = _run_bench(ort_model, img, args.warmup, args.runs)
        _print_stats("ORT", ort_times)
        print(f"  Detections: {_det_str(ort_dets)}")
    print()

    # ── Comparison ───────────────────────────────────────────────────────────
    if trt_times and ort_times:
        print("=" * 54)
        print("Comparison")
        print("=" * 54)
        speedup = median(ort_times) / median(trt_times)
        print(f"  Speedup (TRT vs ORT) : {speedup:.2f}×")
        match = _dets_match(trt_dets, ort_dets)
        print(f"  Detections match     : {'YES ✓' if match else 'NO — see above'}")
        if not match:
            print(f"    TRT: {_det_str(trt_dets)}")
            print(f"    ORT: {_det_str(ort_dets)}")


if __name__ == "__main__":
    main()
