"""
YOLOX-Body-Head-Hand — TensorRT FP16 Inference
===============================================
Benchmark results on Jetson Nano (JetPack R32.7.1 / TRT 8.2.0 / FP16):

  Model       Resolution   Median    FPS
  -------     ----------   ------    ---
  YOLOX-M     480×640      468 ms    ~2
  YOLOX-M     256×320      216 ms    ~5
  YOLOX-S     480×640      313 ms    ~3
  YOLOX-S     256×320       81 ms   ~12  ← SELECTED
  (mAP gap between S and M is only 2.8%)

Recommended engine  : yolox_s_body_head_hand_256x320_fp16.engine
Input  : float32[1, 3, 256, 320]   BGR raw 0-255, CHW
Output : float32[N, 7]             [batchno, classid, score, x1, y1, x2, y2]
         NMS is baked in (_post_ model) — no manual NMS needed.
Classes: 0=body  1=head  2=hand

Two backends (auto-selected):
  1. Native TRT  — loads .engine built by trtexec.
                   Requires: tensorrt + pycuda (both in JetPack 4.6)
  2. ORT TRT EP  — runs .onnx via onnxruntime TensorRT EP; auto-caches engine.
                   Requires: onnxruntime-gpu for aarch64

Usage
-----
    from yolox_trt import YOLOXBodyHeadHand
    model = YOLOXBodyHeadHand("/path/yolox_s_body_head_hand_256x320_fp16.engine")
    dets  = model.infer(bgr_frame)   # list of dicts, coords normalised 0-1
"""

import os
from typing import Any, Dict, List, Optional

import cv2
import numpy as np


# ── Class metadata ─────────────────────────────────────────────────────────────

CLASS_NAMES  = ["body", "head", "hand"]
CLASS_COLORS = {           # BGR
    0: (220, 100,  40),    # body — amber/orange
    1: ( 40,  60, 220),    # head — blue
    2: ( 40, 200,  60),    # hand — green
}

# Pre-allocate output for up to this many detections.
# PINTO _post_ models embed max_output_boxes_per_class=20, 3 classes → 60 max.
_MAX_DET = 128


# ── Pre/post-process (shared by both backends) ─────────────────────────────────

def _preprocess(image_bgr: np.ndarray, model_w: int, model_h: int) -> np.ndarray:
    """Resize → CHW float32 0-255.  Returns shape (1, 3, H, W)."""
    resized = cv2.resize(image_bgr, (model_w, model_h))
    chw     = resized.transpose(2, 0, 1).astype(np.float32)
    return chw[np.newaxis]


def _postprocess(
    raw: np.ndarray,
    score_th: float,
) -> List[Dict[str, Any]]:
    """
    raw : float32 array, reshape to (-1, 7)
    Columns: [batchno, classid, score, x1, y1, x2, y2]
    x1..y2 are in *model-pixel* space; we normalise to [0,1] here.
    """
    if raw.ndim == 1:
        raw = raw.reshape(-1, 7)

    results: List[Dict[str, Any]] = []
    seen: set = set()
    for det in raw:
        score = float(det[2])
        if score < score_th:
            continue
        classid = int(det[1])
        # Skip out-of-range class IDs — NMS padding rows often contain garbage
        if classid < 0 or classid >= len(CLASS_NAMES):
            continue
        # Deduplicate — NMS padding fills remaining rows with the last valid det
        key = (classid, round(score, 3), float(det[3]), float(det[4]),
               float(det[5]), float(det[6]))
        if key in seen:
            continue
        seen.add(key)
        results.append({
            "classid": classid,
            "label":   CLASS_NAMES[classid],
            "score":   round(score, 3),
            "_x1": float(det[3]),
            "_y1": float(det[4]),
            "_x2": float(det[5]),
            "_y2": float(det[6]),
        })
    return results


def _normalise(
    results: List[Dict[str, Any]],
    model_h: int,
    model_w: int,
) -> List[Dict[str, Any]]:
    """Convert model-pixel coords to [0,1] normalised; drop degenerate boxes."""
    out = []
    for d in results:
        x1 = max(0.0, d["_x1"]) / model_w
        y1 = max(0.0, d["_y1"]) / model_h
        x2 = min(d["_x2"], model_w)  / model_w
        y2 = min(d["_y2"], model_h)  / model_h
        if x2 <= x1 or y2 <= y1:
            continue
        out.append({
            "classid": d["classid"],
            "label":   d["label"],
            "score":   d["score"],
            "x1": round(x1, 4),
            "y1": round(y1, 4),
            "x2": round(x2, 4),
            "y2": round(y2, 4),
        })
    return out


# ── Backend A: native TensorRT ─────────────────────────────────────────────────

class _TRTBackend:
    """
    Native TRT via pycuda.
    Context is created explicitly so inference can run on any thread.
    """

    def __init__(self, engine_path: str) -> None:
        import tensorrt as trt
        import pycuda.driver as cuda

        cuda.init()
        self._cuda    = cuda
        self._cu_ctx  = cuda.Device(0).make_context()

        try:
            TRT_LOGGER = trt.Logger(trt.Logger.WARNING)
            # Register all built-in plugins (NMS, etc.) before deserialization
            trt.init_libnvinfer_plugins(TRT_LOGGER, "")
            runtime = trt.Runtime(TRT_LOGGER)
            with open(engine_path, "rb") as f:
                self._engine = runtime.deserialize_cuda_engine(f.read())
            if self._engine is None:
                raise RuntimeError("deserialize_cuda_engine returned None — plugin mismatch or corrupt engine")
        except Exception:
            self._cu_ctx.pop()
            raise

        self._trt_ctx = self._engine.create_execution_context()
        self._stream  = cuda.Stream()

        # ── Introspect bindings (don't assume idx 0=input) ────────────────────
        n = self._engine.num_bindings
        self._in_idx  = next(i for i in range(n) if self._engine.binding_is_input(i))
        self._out_idx = next(i for i in range(n) if not self._engine.binding_is_input(i))

        in_shape  = self._engine.get_binding_shape(self._in_idx)
        out_shape = self._engine.get_binding_shape(self._out_idx)

        self.model_h = int(in_shape[2])
        self.model_w = int(in_shape[3])

        in_size  = int(np.prod(in_shape))
        # Output may be dynamic (-1); pre-allocate _MAX_DET × 7
        out_size = (_MAX_DET * 7
                    if -1 in out_shape
                    else int(np.prod(out_shape)))

        self._h_in   = cuda.pagelocked_empty(in_size,  dtype=np.float32)
        self._h_out  = cuda.pagelocked_empty(out_size, dtype=np.float32)
        self._d_in   = cuda.mem_alloc(self._h_in.nbytes)
        self._d_out  = cuda.mem_alloc(self._h_out.nbytes)

        self._bindings = [None] * n
        self._bindings[self._in_idx]  = int(self._d_in)
        self._bindings[self._out_idx] = int(self._d_out)

        # Pop context — will be pushed/popped around each infer() call
        self._cu_ctx.pop()

    def infer(self, image_bgr: np.ndarray, score_th: float) -> List[Dict[str, Any]]:
        cuda = self._cuda
        self._cu_ctx.push()
        try:
            inp = _preprocess(image_bgr, self.model_w, self.model_h)
            np.copyto(self._h_in, inp.ravel())

            # Zero the output device buffer so TRT NMS padding rows are always 0.0
            # (TRT 8.2 static NMS output only writes valid rows; remainder retains
            #  stale/garbage values from the previous inference call)
            cuda.memset_d32_async(self._d_out, 0, len(self._h_out), self._stream)
            cuda.memcpy_htod_async(self._d_in, self._h_in, self._stream)
            self._trt_ctx.execute_async_v2(
                bindings=self._bindings, stream_handle=self._stream.handle
            )
            cuda.memcpy_dtoh_async(self._h_out, self._d_out, self._stream)
            self._stream.synchronize()

            # Get actual output row count (TRT 8.2 sets this after inference)
            try:
                out_shape = self._trt_ctx.get_binding_shape(self._out_idx)
                n_rows    = int(np.prod(out_shape)) // 7
            except Exception:
                n_rows    = len(self._h_out) // 7

            raw     = self._h_out[: n_rows * 7]
            results = _postprocess(raw, score_th)
            return _normalise(results, self.model_h, self.model_w)
        finally:
            self._cu_ctx.pop()


# ── Backend B: onnxruntime TensorRT EP ─────────────────────────────────────────

class _ORTBackend:
    """
    onnxruntime + TRT EP.  First run compiles & caches the TRT engine.
    Falls back to CUDA EP then CPU EP automatically.
    """

    def __init__(self, onnx_path: str, cache_dir: str, fp16: bool) -> None:
        import onnxruntime as ort

        # TRT EP: backbone runs on TRT (~44ms), NMS runs on CPU (correct classids).
        # Engine cache must be pre-compiled before service start (avoids 5-min
        # first-run compilation that deadlocks uvicorn via CUDA mutex contention).
        providers = [
            (
                "TensorrtExecutionProvider",
                {
                    "trt_engine_cache_enable": True,
                    "trt_engine_cache_path":   cache_dir,
                    "trt_fp16_enable":         fp16,
                    "trt_max_workspace_size":  1 << 29,
                },
            ),
            "CUDAExecutionProvider",
            "CPUExecutionProvider",
        ]
        so = ort.SessionOptions()
        so.log_severity_level = 3
        self._sess    = ort.InferenceSession(onnx_path, sess_options=so,
                                              providers=providers)
        inp           = self._sess.get_inputs()[0]
        self._in_name = inp.name
        shape         = inp.shape
        self.model_h  = int(shape[2])
        self.model_w  = int(shape[3])
        print(f"[YOLOX] ORT active providers: {self._sess.get_providers()}",
              flush=True)

    def infer(self, image_bgr: np.ndarray, score_th: float) -> List[Dict[str, Any]]:
        inp     = _preprocess(image_bgr, self.model_w, self.model_h)
        raw     = self._sess.run(None, {self._in_name: inp})[0]
        results = _postprocess(raw, score_th)
        return _normalise(results, self.model_h, self.model_w)


# ── Public API ─────────────────────────────────────────────────────────────────

class YOLOXBodyHeadHand:
    """
    Parameters
    ----------
    model_path        : .engine (native TRT) or .onnx (ORT TRT EP)
    score_threshold   : minimum confidence to keep a detection (default 0.40)
    fp16              : for ORT EP only — enable FP16 kernel (default True)
    engine_cache_dir  : ORT EP engine cache dir (defaults to model dir)
    """

    def __init__(
        self,
        model_path: str,
        score_threshold: float = 0.40,
        fp16: bool = True,
        engine_cache_dir: Optional[str] = None,
    ) -> None:
        self.score_threshold = score_threshold
        ext = os.path.splitext(model_path)[1].lower()

        if ext == ".engine":
            try:
                self._backend: Any = _TRTBackend(model_path)
                print(f"[YOLOX] Native TRT  {os.path.basename(model_path)}"
                      f"  {self.model_h}×{self.model_w}  th={score_threshold}",
                      flush=True)
                return
            except Exception as exc:
                print(f"[YOLOX] Native TRT failed ({exc}) — trying ORT …", flush=True)
                onnx = model_path.replace(".engine", ".onnx")
                if os.path.exists(onnx):
                    model_path = onnx
                    ext        = ".onnx"
                else:
                    raise

        if ext == ".onnx":
            cache = engine_cache_dir or os.path.dirname(os.path.abspath(model_path))
            self._backend = _ORTBackend(model_path, cache, fp16)
            print(f"[YOLOX] ORT TRT EP  {os.path.basename(model_path)}"
                  f"  {self.model_h}×{self.model_w}  th={score_threshold}",
                  flush=True)
            return

        raise ValueError(f"[YOLOX] Unsupported model extension: {ext!r}")

    @property
    def model_h(self) -> int:
        return self._backend.model_h

    @property
    def model_w(self) -> int:
        return self._backend.model_w

    def infer(self, image_bgr: np.ndarray) -> List[Dict[str, Any]]:
        """
        Run detection.

        Returns list of dicts:
            classid : int   (0=body  1=head  2=hand)
            label   : str
            score   : float (0–1)
            x1, y1, x2, y2 : float (0–1, normalised to input frame size)
        """
        return self._backend.infer(image_bgr, self.score_threshold)

    def draw(
        self, bgr_frame: np.ndarray, detections: List[Dict[str, Any]]
    ) -> np.ndarray:
        """Overlay bounding boxes on bgr_frame (in-place). Returns frame."""
        h, w = bgr_frame.shape[:2]
        for d in detections:
            x1 = int(d["x1"] * w);  y1 = int(d["y1"] * h)
            x2 = int(d["x2"] * w);  y2 = int(d["y2"] * h)
            col = CLASS_COLORS.get(d["classid"], (200, 200, 200))
            cv2.rectangle(bgr_frame, (x1, y1), (x2, y2), (255, 255, 255), 2)
            cv2.rectangle(bgr_frame, (x1, y1), (x2, y2), col, 1)
            txt = f"{d['label']} {d['score']:.2f}"
            ly  = max(y1 - 6, 14)
            cv2.putText(bgr_frame, txt, (x1, ly),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(bgr_frame, txt, (x1, ly),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 1, cv2.LINE_AA)
        return bgr_frame
