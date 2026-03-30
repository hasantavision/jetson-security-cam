#!/usr/bin/env python3
"""
Pre-build ORT TRT EP engine cache for the YOLOX-S ONNX model.

Run this once after a JetPack upgrade or model change.
Subsequent server starts will load the cached engine instantly
instead of blocking for ~5 minutes on first inference.

Usage:
    python3 prebuild_ort_cache.py
"""

import sys
import time
from pathlib import Path

import numpy as np

MODELS_DIR = Path(__file__).parent.parent / "models"
ONNX_PATH  = MODELS_DIR / "yolox_s_body_head_hand_post_0299_0.4983_1x3x256x320_ir8.onnx"

if not ONNX_PATH.exists():
    print(f"[ERROR] ONNX not found: {ONNX_PATH}")
    sys.exit(1)

print(f"ONNX : {ONNX_PATH.name}")
print(f"Cache: {MODELS_DIR}")
print()

import onnxruntime as ort

providers = [
    (
        "TensorrtExecutionProvider",
        {
            "trt_engine_cache_enable": True,
            "trt_engine_cache_path":   str(MODELS_DIR),
            "trt_fp16_enable":         True,
            "trt_max_workspace_size":  1 << 29,
        },
    ),
    "CUDAExecutionProvider",
    "CPUExecutionProvider",
]

so = ort.SessionOptions()
so.log_severity_level = 3

print("Loading ORT session (may compile TRT engine on first run)…")
t0   = time.perf_counter()
sess = ort.InferenceSession(str(ONNX_PATH), sess_options=so, providers=providers)
inp  = sess.get_inputs()[0]
print(f"  Session ready in {(time.perf_counter()-t0)*1000:.0f} ms")
print(f"  Active providers: {sess.get_providers()}")
print(f"  Input  : {inp.name}  {inp.shape}")
print()

# Run one warm-up inference to ensure the engine is fully compiled and cached
h, w    = int(inp.shape[2]), int(inp.shape[3])
dummy   = np.zeros((1, 3, h, w), dtype=np.float32)
print("Running one warm-up inference to flush cache to disk…")
t0  = time.perf_counter()
out = sess.run(None, {inp.name: dummy})
print(f"  Inference: {(time.perf_counter()-t0)*1000:.0f} ms  output shape={out[0].shape}")
print()

# Report cache files written
cache_files = sorted(MODELS_DIR.glob("TensorrtExecutionProvider_TRTKernel_*.engine"))
print(f"TRT EP cache files in {MODELS_DIR}:")
for f in cache_files:
    print(f"  {f.name}  ({f.stat().st_size // (1024*1024)} MB)")

print()
print("Done — ORT TRT EP will load instantly on next server start.")
