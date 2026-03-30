#!/usr/bin/env python3
"""
SMART Home Security — Backend
FastAPI · python-socketio · GStreamer WebRTC · OpenCV Motion Detection

Jetson Nano / IMX519 ArduCam
  Camera   : nvarguscamerasrc → tee → [WebRTC branch] + [motion appsink branch]
  Signaling: Socket.IO over ASGI (python-socketio AsyncServer)
  API      : FastAPI with async handlers
  Motion   : OpenCV frame-diff on 320×180 branch, SSE push to browser
"""

import argparse
import asyncio

# python-socketio 5.x uses asyncio.create_task (Python 3.7+).
# Patch it for Python 3.6 with the equivalent ensure_future.
if not hasattr(asyncio, 'create_task'):
    asyncio.create_task = asyncio.ensure_future
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

import gi
gi.require_version("Gst",       "1.0")
gi.require_version("GstWebRTC", "1.0")
gi.require_version("GstSdp",    "1.0")
from gi.repository import Gst, GstWebRTC, GstSdp, GLib

import socketio
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import uvicorn


# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR    = Path(__file__).parent
DIST_DIR    = BASE_DIR.parent / "dist"
CONFIG_FILE = BASE_DIR / "config.json"


# ── Persisted configuration ───────────────────────────────────────────────────

_DEFAULT_CONFIG = {
    "sensor_id":        0,
    "width":            1280,
    "height":           720,
    "fps":              21,
    "bitrate":          4_000_000,
    "jpeg_quality":     85,
    "motion_threshold": 5000,
    "motion_cooldown":  3.0,
    "zone":             {"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8},
    "focus":            500,
    "i2c_bus":          7,
    # ── YOLO detection ────────────────────────────────────────────────────────
    "yolo_enabled":     True,
    "yolo_threshold":   0.40,
    # Path is relative to the project root (00_SMART/) — can be overridden
    "yolo_engine":      "models/yolox_s_body_head_hand_post_0299_0.4983_1x3x256x320_ir8.onnx",
}

cfg: dict = dict(_DEFAULT_CONFIG)


def load_config() -> None:
    if CONFIG_FILE.exists():
        cfg.update(json.loads(CONFIG_FILE.read_text()))


def save_config() -> None:
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))


load_config()


# ── asyncio loop reference ─────────────────────────────────────────────────────
# Set during FastAPI startup (inside uvicorn's loop). Used by GLib callbacks
# to safely schedule coroutines via run_coroutine_threadsafe.

_loop: Optional[asyncio.AbstractEventLoop] = None


def _emit(event: str, data, sid: Optional[str] = None) -> None:
    """Fire-and-forget emit from any thread into the asyncio event loop."""
    target = sid or current_sid
    if _loop is None or target is None:
        return
    asyncio.run_coroutine_threadsafe(sio.emit(event, data, to=target), _loop)


# ── Socket.IO + FastAPI app ───────────────────────────────────────────────────

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
api = FastAPI(title="SMART Home Security", version="2.0.0", docs_url=None)
app = socketio.ASGIApp(sio, other_asgi_app=api)


# ── Focus control (ArduCam IMX519 VCM via i2cset) ────────────────────────────

FOCUS_ADDR     = 0x0C
_bus_detected  = False


def _detect_focuser_bus() -> Optional[int]:
    import subprocess
    for bus in (7, 8, 6, 9, 10):
        try:
            out = subprocess.run(
                ["i2cdetect", "-r", "-y", str(bus)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3,
            ).stdout.decode("utf-8", errors="ignore")
            for line in out.splitlines():
                if ":" not in line:
                    continue
                cells = line.split(":", 1)[1].lower().split()
                if "0c" in cells:
                    print(f"[FOCUS] Focuser at 0x0C on i2c-{bus}", flush=True)
                    return bus
        except Exception:
            pass
    return None


def _focus_write_dac(bus: int, value: int) -> None:
    import subprocess
    value = max(0, min(1000, value))
    dac   = int(value / 1000.0 * 4095) << 4
    hi, lo = (dac >> 8) & 0xFF, dac & 0xFF
    addr  = f"0x{FOCUS_ADDR:02x}"
    try:
        subprocess.run(["i2cset", "-y", str(bus), addr, "0x00", f"0x{hi:02x}"],
                       check=True, timeout=2, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(["i2cset", "-y", str(bus), addr, "0x01", f"0x{lo:02x}"],
                       check=True, timeout=2, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except Exception as exc:
        print(f"[FOCUS] DAC write failed: {exc}")


def focus_init(bus: int, initial: int) -> None:
    """Called after pipeline starts (VCM only responds once sensor is powered)."""
    global _bus_detected
    import subprocess
    detected = None
    for attempt in range(5):
        detected = _detect_focuser_bus()
        if detected is not None:
            break
        print(f"[FOCUS] VCM not ready, attempt {attempt + 1}/5 …", flush=True)
        time.sleep(1)
    if detected is not None:
        bus = detected
    cfg["i2c_bus"] = bus
    _bus_detected  = True
    save_config()
    try:
        subprocess.run(["i2cset", "-y", str(bus), f"0x{FOCUS_ADDR:02x}", "0x02", "0x00"],
                       check=True, timeout=2, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        _focus_write_dac(bus, initial)
        print(f"[FOCUS] Init OK  bus={bus}  value={initial}", flush=True)
    except Exception as exc:
        print(f"[FOCUS] Init failed: {exc}", flush=True)


def focus_set(value: int) -> None:
    global _bus_detected
    value = max(0, min(1000, int(value)))
    bus   = cfg.get("i2c_bus", 7)
    if not _bus_detected:
        detected = _detect_focuser_bus()
        if detected is not None:
            bus = detected
            cfg["i2c_bus"] = bus
        _bus_detected = True
    _focus_write_dac(bus, value)
    cfg["focus"] = value


# ── Colour correction state ───────────────────────────────────────────────────

_color = {"hue": 0.0, "saturation": 1.0, "brightness": 0.0, "contrast": 1.0}


# ── GStreamer pipeline (WebRTC + motion tee) ──────────────────────────────────

pipeline:    Optional[Gst.Pipeline]       = None
webrtcbin:   Optional[Gst.Element]        = None
videobal:    Optional[Gst.Element]        = None
appsink_el:  Optional[Gst.Element]        = None   # held for the pull-thread
pipeline_lock = threading.Lock()
current_sid:  Optional[str]              = None
_gst_args                                = None
_motion_frame_count                      = 0


def _el(factory: str, name: str) -> Gst.Element:
    el = Gst.ElementFactory.make(factory, name)
    if el is None:
        raise RuntimeError(f"Cannot create GStreamer element '{factory}'")
    return el


def _build_pipeline():
    w, h, fps = cfg["width"], cfg["height"], cfg["fps"]
    stun      = _gst_args.stun if _gst_args else "stun://stun.l.google.com:19302"
    bitrate   = cfg.get("bitrate", 4_000_000)

    p = Gst.Pipeline.new("smart-home")

    # Source → tee
    src  = _el("nvarguscamerasrc", "src");  cf1 = _el("capsfilter", "caps1")
    tee  = _el("tee",              "tee")

    # ── WebRTC branch ─────────────────────────────────────────────────────────
    q1   = _el("queue",            "q_webrtc")
    conv = _el("nvvidconv",        "conv");   bal   = _el("videobalance", "bal")
    cv2e = _el("nvvidconv",        "conv2");  cf2   = _el("capsfilter",   "caps2")
    enc  = _el("nvv4l2h264enc",    "enc");    parse = _el("h264parse",    "parse")
    pay  = _el("rtph264pay",       "pay");    wb    = _el("webrtcbin",    "sendrecv")

    # ── Motion detection branch (320×180 BGR → appsink) ──────────────────────
    q2   = _el("queue",            "q_motion")
    cv3  = _el("nvvidconv",        "conv3");  cfm   = _el("capsfilter",   "caps_m")
    vcv  = _el("videoconvert",     "vconv");  sink  = _el("appsink",      "msink")

    # ── Properties ───────────────────────────────────────────────────────────
    src.set_property("sensor-id", cfg["sensor_id"])
    src.set_property("wbmode", 1)

    cf1.set_property("caps", Gst.Caps.from_string(
        f"video/x-raw(memory:NVMM),width={w},height={h},framerate={fps}/1,format=NV12"
    ))

    for k in ("hue", "saturation", "brightness", "contrast"):
        bal.set_property(k, _color[k])

    cf2.set_property("caps", Gst.Caps.from_string(
        f"video/x-raw(memory:NVMM),width={w},height={h},"
        f"framerate={fps}/1,format=NV12,colorimetry=bt709"
    ))

    enc.set_property("bitrate",        bitrate)
    enc.set_property("insert-sps-pps", True)
    enc.set_property("idrinterval",    10)
    parse.set_property("config-interval", -1)
    pay.set_property("config-interval",    1)
    pay.set_property("pt",                96)
    wb.set_property("stun-server", stun)

    # WebRTC queue: small, leaky-downstream to avoid stalls
    q1.set_property("max-size-buffers", 3);  q1.set_property("leaky", 2)
    # Motion queue: single-slot, always fresh frame
    q2.set_property("max-size-buffers", 1);  q2.set_property("leaky", 2)

    # 320×256 matches YOLOX-S model input exactly — GPU does the downscale for free,
    # eliminating the CPU cv2.resize() in _preprocess.  Motion detection works fine
    # at this resolution too.
    cfm.set_property("caps", Gst.Caps.from_string("video/x-raw,width=320,height=256"))
    # emit-signals=False + sync=False: frames are pulled by a dedicated Python
    # thread via try_pull_sample(). Using GLib signals instead causes severe
    # GIL starvation — uvicorn's asyncio loop holds the GIL most of the time
    # (WebRTC packets at 21 fps + SSE + HTTP), so the GLib thread that would
    # invoke the Python callback only gets a turn every ~25 seconds.
    sink.set_property("emit-signals", False)
    sink.set_property("sync",         False)
    sink.set_property("drop",         True)
    sink.set_property("max-buffers",  2)
    sink.set_property("caps", Gst.Caps.from_string("video/x-raw,format=BGR"))

    # ── Add all elements ──────────────────────────────────────────────────────
    for el in (src, cf1, tee, q1, conv, bal, cv2e, cf2, enc, parse, pay, wb,
               q2, cv3, cfm, vcv, sink):
        p.add(el)

    # ── Link source → tee ─────────────────────────────────────────────────────
    src.link(cf1)
    cf1.link(tee)

    # ── Tee → WebRTC branch ───────────────────────────────────────────────────
    tee.get_request_pad("src_%u").link(q1.get_static_pad("sink"))
    for a, b in ((q1, conv), (conv, bal), (bal, cv2e), (cv2e, cf2),
                 (cf2, enc), (enc, parse), (parse, pay)):
        a.link(b)
    wb_sink = wb.get_request_pad("sink_0")
    if wb_sink is None:
        raise RuntimeError("webrtcbin sink_0 unavailable — install gstreamer1.0-nice")
    pay.get_static_pad("src").link(wb_sink)

    # ── Tee → Motion branch ───────────────────────────────────────────────────
    tee.get_request_pad("src_%u").link(q2.get_static_pad("sink"))
    for a, b in ((q2, cv3), (cv3, cfm), (cfm, vcv), (vcv, sink)):
        a.link(b)

    wb.connect("on-negotiation-needed", _on_negotiation_needed)
    wb.connect("on-ice-candidate",      _on_ice_candidate)

    return p, wb, bal, sink


# ── GStreamer callbacks (run on GLib thread) ──────────────────────────────────

def _on_bus_message(bus, msg, _):
    if msg.type == Gst.MessageType.ERROR:
        err, dbg = msg.parse_error()
        print(f"[GST ERROR] {err.message} | {dbg}", flush=True)
    elif msg.type == Gst.MessageType.WARNING:
        w, _ = msg.parse_warning()
        print(f"[GST WARN]  {w.message}", flush=True)


def _on_negotiation_needed(element):
    print("[WS] Negotiation needed — creating offer", flush=True)
    promise = Gst.Promise.new_with_change_func(_on_offer_created, element, None)
    element.emit("create-offer", None, promise)


def _on_offer_created(promise, element, _):
    try:
        promise.wait()
        reply = promise.get_reply()
        offer = reply.get_value("offer") if reply else None
        if offer is None:
            print("[WS] ERROR: offer is None — WebRTC offer creation failed", flush=True)
            return
        # Keep original for set-local-description; send patched SDP to browser
        element.emit("set-local-description", offer, Gst.Promise.new())
        sdp = (offer.sdp.as_text()
               .replace("a=sendrecv",      "a=sendonly")
               .replace("a=setup:actpass", "a=setup:passive"))
        print(f"[WS] Sending offer to {current_sid}", flush=True)
        _emit("offer", sdp)
    except Exception as exc:
        print(f"[WS] ERROR in _on_offer_created: {exc}", flush=True)


def _on_ice_candidate(element, mlineindex, candidate):
    _emit("candidate", {"sdpMLineIndex": mlineindex, "candidate": candidate})


def _process_sample(sample) -> None:
    """
    Decode one GStreamer sample and dispatch to motion detector and/or YOLO.
    Called from _appsink_pull_thread — runs in its own Python thread, fully
    decoupled from the GLib main loop and uvicorn's asyncio event loop.
    """
    global _motion_frame_count
    _motion_frame_count += 1

    # Sub-sample: motion at ~2 Hz, YOLO at ~4 Hz (pipeline runs at 21 fps).
    need_motion = (_motion_frame_count % 10 == 0)
    need_yolo   = (_motion_frame_count % 5  == 0)

    if not (need_motion or need_yolo):
        return

    try:
        buf       = sample.get_buffer()
        st        = sample.get_caps().get_structure(0)
        w, h      = st.get_value("width"), st.get_value("height")
        ok, info  = buf.map(Gst.MapFlags.READ)
        if ok:
            try:
                frame = np.ndarray((h, w, 3), dtype=np.uint8, buffer=info.data).copy()
            finally:
                # Always unmap — even if ndarray creation raises — to avoid
                # leaking GStreamer buffer pool slots and stalling the pipeline.
                buf.unmap(info)
            if need_motion:
                motion.process_frame(frame)
            if need_yolo and cfg.get("yolo_enabled", True):
                try:
                    _yolo_queue.put_nowait(frame)
                except queue.Full:
                    pass  # YOLO worker still busy — drop this frame
    except Exception as exc:
        print(f"[APPSINK] Frame error: {exc}", flush=True)


def _appsink_pull_thread() -> None:
    """
    Dedicated thread that pulls frames from the appsink via the
    "try-pull-sample" GObject action signal.

    Why not emit-signals? GStreamer fires signal callbacks through PyGObject's
    GLib main loop, which requires the Python GIL. Uvicorn's asyncio event loop
    (handling WebRTC packets at 21 fps + SSE + HTTP) holds the GIL most of the
    time, so the GLib thread only gets a turn every ~25 seconds — making motion
    detection effectively broken. Running the pull in its own thread avoids all
    GLib / GIL contention.

    Note: we use sink.emit("try-pull-sample", timeout) rather than the typed
    AppSink method try_pull_sample() because Gst.ElementFactory.make() returns
    a Gst.Element — the AppSink-specific methods are only available if GstApp
    is explicitly imported.  The GObject action-signal works on any element type.
    """
    print("[APPSINK] Pull thread started", flush=True)
    while True:
        with pipeline_lock:
            sink = appsink_el
        if sink is None:
            time.sleep(0.05)
            continue
        try:
            # Block up to 100 ms waiting for a frame; returns None on timeout.
            sample = sink.emit("try-pull-sample", 100_000_000)   # ns → 100 ms
        except Exception as exc:
            print(f"[APPSINK] Pull error: {exc}", flush=True)
            time.sleep(0.05)
            continue
        if sample is None:
            continue
        _process_sample(sample)


# ── Pipeline lifecycle ────────────────────────────────────────────────────────

def _start_pipeline() -> None:
    global pipeline, webrtcbin, videobal, appsink_el
    p, wb, bal, sink = _build_pipeline()
    gst_bus = p.get_bus()
    gst_bus.add_signal_watch()
    gst_bus.connect("message", _on_bus_message, None)
    with pipeline_lock:
        pipeline, webrtcbin, videobal, appsink_el = p, wb, bal, sink
    pipeline.set_state(Gst.State.PLAYING)
    time.sleep(2)   # wait for sensor power-up before touching VCM
    focus_init(cfg.get("i2c_bus", 7), cfg.get("focus", 500))
    print(
        f"[PIPELINE] {cfg['width']}x{cfg['height']} @ {cfg['fps']}fps  "
        f"bitrate={cfg.get('bitrate', 4_000_000)//1000} kbps",
        flush=True,
    )


def _stop_pipeline() -> None:
    global pipeline, webrtcbin, videobal, appsink_el
    with pipeline_lock:
        p, pipeline, webrtcbin, videobal, appsink_el = pipeline, None, None, None, None
    if p:
        p.set_state(Gst.State.NULL)
        time.sleep(1)   # let nvarguscamerasrc release the sensor


def _restart_for(sid: str) -> None:
    _stop_pipeline()
    if current_sid == sid:
        _start_pipeline()


# ── Motion detector ───────────────────────────────────────────────────────────

class MotionDetector:
    def __init__(self):
        self._prev_gray = None
        self._last_event = 0.0
        self._listeners: list = []
        self._lock = threading.Lock()

    def add_listener(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=20)
        with self._lock:
            self._listeners.append(q)
        return q

    def remove_listener(self, q: queue.Queue) -> None:
        with self._lock:
            self._listeners = [l for l in self._listeners if l is not q]

    @property
    def listener_count(self) -> int:
        """Number of active SSE clients currently subscribed to motion events."""
        with self._lock:
            return len(self._listeners)

    def notify(self, event_type: str) -> None:
        payload = {"event": event_type, "ts": time.time()}
        with self._lock:
            for q in self._listeners:
                try:
                    q.put_nowait(payload)
                except queue.Full:
                    pass

    def process_frame(self, frame: np.ndarray) -> None:
        h, w  = frame.shape[:2]
        z     = cfg["zone"]
        x1    = int(z["x"]                  * w)
        y1    = int(z["y"]                  * h)
        x2    = int((z["x"] + z["width"])   * w)
        y2    = int((z["y"] + z["height"])  * h)
        roi   = frame[y1:y2, x1:x2]
        gray  = cv2.GaussianBlur(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY), (5, 5), 0)

        if self._prev_gray is None or self._prev_gray.shape != gray.shape:
            self._prev_gray = gray
            return

        delta = cv2.absdiff(self._prev_gray, gray)
        self._prev_gray = gray
        _, thresh = cv2.threshold(delta, 25, 255, cv2.THRESH_BINARY)
        score = cv2.countNonZero(thresh)

        now = time.time()
        if (score > cfg["motion_threshold"]
                and (now - self._last_event) > cfg["motion_cooldown"]):
            self._last_event = now
            self.notify("motion")
            print(f"[MOTION] Triggered  score={score}", flush=True)


motion = MotionDetector()


# ── YOLO detection (YOLOX-S 256×320 FP16, ~12 FPS on Nano) ───────────────────

_yolo_model:        Optional[Any]              = None
_yolo_lock          = threading.Lock()
_yolo_queue:        queue.Queue                = queue.Queue(maxsize=1)
_latest_detections: List[Dict[str, Any]]       = []
_detections_lock    = threading.Lock()

# Project root: one level up from backend/ (i.e. the smart-home repo root)
_PROJECT_ROOT = BASE_DIR.parent


def _yolo_engine_path() -> Optional[str]:
    """Resolve engine path from config; search project root if relative."""
    raw = cfg.get("yolo_engine", "")
    if not raw:
        return None
    p = Path(raw)
    if p.is_absolute():
        return str(p) if p.exists() else None
    candidate = _PROJECT_ROOT / raw
    return str(candidate) if candidate.exists() else None


def _yolo_worker() -> None:
    """Dedicated thread: pops frames from _yolo_queue, runs inference."""
    global _latest_detections
    print("[YOLO] Worker thread started", flush=True)
    while True:
        frame = _yolo_queue.get()
        if frame is None:            # poison pill
            break
        if not cfg.get("yolo_enabled", True):
            continue
        with _yolo_lock:
            model = _yolo_model
        if model is None:
            continue
        try:
            dets = model.infer(frame)
            with _detections_lock:
                changed = dets != _latest_detections
                _latest_detections = dets
            # Only push to browser when results actually changed — avoids
            # flooding the asyncio loop with identical payloads at 4 Hz.
            if changed and _loop is not None:
                asyncio.run_coroutine_threadsafe(
                    sio.emit("detections", dets), _loop
                )
        except Exception as exc:
            print(f"[YOLO] Inference error: {exc}", flush=True)


def _yolo_init() -> None:
    """Load the TRT engine in a background thread (keeps startup fast)."""
    global _yolo_model
    engine_path = _yolo_engine_path()
    if engine_path is None:
        print(
            f"[YOLO] Engine not found: {cfg.get('yolo_engine')}  "
            "(run trtexec conversion first — detection disabled)",
            flush=True,
        )
        return
    try:
        # Import here so the rest of the server starts even if pycuda missing
        from yolox_trt import YOLOXBodyHeadHand
        model = YOLOXBodyHeadHand(
            engine_path,
            score_threshold=cfg.get("yolo_threshold", 0.40),
        )
        with _yolo_lock:
            _yolo_model = model
    except Exception as exc:
        print(f"[YOLO] Failed to load engine: {exc}", flush=True)


# Start YOLO worker thread immediately (waits for frames on the queue)
threading.Thread(target=_yolo_worker,        daemon=True, name="yolo-worker" ).start()
# Load model in background so pipeline starts without delay
threading.Thread(target=_yolo_init,          daemon=True, name="yolo-init"   ).start()
# Pull frames from the appsink directly — avoids GIL starvation from GLib signals
threading.Thread(target=_appsink_pull_thread, daemon=True, name="appsink-pull").start()


# ── Socket.IO event handlers ──────────────────────────────────────────────────

_last_start_time = 0.0
_sid_is_local: Dict[str, bool] = {}  # sid → True if connection is from localhost

_server_start_time = time.time()

@sio.event
async def connect(sid, environ):
    global _loop
    if _loop is None:
        _loop = asyncio.get_event_loop()
    remote = environ.get('REMOTE_ADDR', '')
    _sid_is_local[sid] = remote in ('127.0.0.1', '::1')
    print(f"[WS] Connected   {sid}  ({'local' if _sid_is_local[sid] else remote})", flush=True)
    # Tell the browser when this server process started.
    # If the browser's cached start_time is older, it knows a restart happened
    # and will reload itself.
    await sio.emit("server_start", {"t": _server_start_time}, to=sid)


@sio.event
async def disconnect(sid):
    # Keep _sid_is_local entry so the priority check in `start` still works for
    # the stale current_sid after the owning client reconnects with a new sid.
    # It will be overwritten when the new connection's `connect` fires.
    # Do NOT clear current_sid — _restart_for() checks `current_sid == sid`
    # after _stop_pipeline(); clearing it early makes the guard fail and the
    # pipeline never restarts.
    print(f"[WS] Disconnected {sid}", flush=True)


@sio.event
async def start(sid):
    global current_sid, _last_start_time
    now = time.time()

    is_local = _sid_is_local.get(sid, False)

    # Priority: local display (Jetson itself) always wins over remote clients.
    # If the pipeline is already running for a different connected client:
    #   - Remote client requesting while local client is active → reject.
    #   - Local client requesting while remote client is active → kick remote.
    #   - Same priority (both local or both remote) → apply debounce.
    if pipeline is not None and current_sid and current_sid != sid:
        current_is_local = _sid_is_local.get(current_sid, False)
        if current_is_local and not is_local:
            print(f"[WS] Rejected start from remote {sid} — local display has priority", flush=True)
            return
        if not current_is_local and is_local:
            print(f"[WS] Local display {sid} kicking remote {current_sid}", flush=True)
            # Fall through and restart for the local client
        elif now - _last_start_time < 3.0:
            print(f"[WS] Debounced start from {sid}", flush=True)
            return
    elif now - _last_start_time < 3.0:
        print(f"[WS] Debounced start from {sid}", flush=True)
        return

    # Clean up stale locality entries except the ones we still need
    old = current_sid
    _last_start_time = now
    current_sid      = sid
    if old and old != sid:
        _sid_is_local.pop(old, None)
    print(f"[WS] Pipeline start requested by {sid} ({'local' if is_local else 'remote'})", flush=True)
    threading.Thread(target=_restart_for, args=(sid,), daemon=True, name="pipeline").start()


@sio.event
async def answer(sid, sdp_text: str):
    print(f"[WS] Answer received from {sid}", flush=True)
    with pipeline_lock:
        wb = webrtcbin
    if wb is None:
        print("[WS] ERROR: answer received but no pipeline", flush=True)
        return
    _, sdp_msg = GstSdp.SDPMessage.new()
    GstSdp.sdp_message_parse_buffer(sdp_text.encode(), sdp_msg)
    ans = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, sdp_msg)
    wb.emit("set-remote-description", ans, Gst.Promise.new())
    print("[WS] Remote description set OK", flush=True)


@sio.event
async def candidate(sid, data: dict):
    with pipeline_lock:
        wb = webrtcbin
    if wb is None:
        return
    wb.emit("add-ice-candidate", data["sdpMLineIndex"], data["candidate"])


# ── REST API ──────────────────────────────────────────────────────────────────

@api.get("/api/events")
async def sse_events():
    """Server-Sent Events stream for motion / detection alerts."""
    q    = motion.add_listener()
    loop = asyncio.get_event_loop()

    async def generator():
        try:
            while True:
                try:
                    data = await loop.run_in_executor(None, lambda: q.get(timeout=30))
                    yield f"data: {json.dumps(data)}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            motion.remove_listener(q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api.get("/api/config")
async def get_config():
    return JSONResponse(cfg)


@api.post("/api/config")
async def post_config(request: Request):
    cfg.update(await request.json())
    save_config()
    return {"ok": True}


@api.get("/api/focus")
async def get_focus():
    return {"focus": cfg.get("focus", 500)}


@api.post("/api/focus")
async def post_focus(request: Request):
    data  = await request.json()
    value = int(data.get("focus", data.get("value", 500)))
    focus_set(value)
    save_config()
    return {"ok": True, "focus": value}


@api.post("/api/autofocus")
async def post_autofocus():
    # Placeholder: returns current best value
    value = cfg.get("focus", 500)
    focus_set(value)
    save_config()
    return {"ok": True, "focus": value}


@api.get("/api/color")
async def get_color():
    return JSONResponse(_color)


@api.post("/api/color")
async def post_color(request: Request):
    data   = await request.json()
    limits = {
        "hue":        (-1.0, 1.0),
        "saturation": (0.0,  2.0),
        "brightness": (-1.0, 1.0),
        "contrast":   (0.0,  2.0),
    }
    for k, (lo, hi) in limits.items():
        if k in data:
            v = max(lo, min(hi, float(data[k])))
            _color[k] = v
            with pipeline_lock:
                if videobal is not None:
                    videobal.set_property(k, v)
    return JSONResponse(_color)


@api.get("/api/settings")
async def get_settings():
    return {k: cfg[k] for k in ("width", "height", "fps", "bitrate")}


@api.post("/api/settings")
async def post_settings(request: Request):
    data    = await request.json()
    allowed = {
        "width":   (int, [640, 1280, 1920, 3840]),
        "height":  (int, [360, 720, 1080, 2160]),
        "fps":     (int, [10, 15, 20, 21, 24, 30, 60]),
        "bitrate": (int, None),
    }
    for k, (typ, choices) in allowed.items():
        if k not in data:
            continue
        v = typ(data[k])
        if choices and v not in choices:
            return JSONResponse({"error": f"{k} must be one of {choices}"}, status_code=400)
        if k == "bitrate":
            v = max(500_000, min(20_000_000, v))
        cfg[k] = v
    save_config()
    return JSONResponse(cfg)


@api.get("/api/info")
async def get_info():
    uptime = ""
    try:
        secs = float(Path("/proc/uptime").read_text().split()[0])
        h, rem = divmod(int(secs), 3600)
        m, s   = divmod(rem, 60)
        uptime = f"{h}h {m}m {s}s"
    except Exception:
        pass

    temp = ""
    for p in ("/sys/class/thermal/thermal_zone0/temp",
              "/sys/devices/virtual/thermal/thermal_zone0/temp"):
        try:
            if Path(p).exists():
                temp = f"{int(Path(p).read_text().strip()) / 1000:.1f}°C"
                break
        except Exception:
            pass

    return {
        "resolution":    f"{cfg['width']}x{cfg['height']}",
        "fps":           cfg["fps"],
        "bitrate_kbps":  cfg.get("bitrate", 4_000_000) // 1000,
        "focus":         cfg.get("focus", 500),
        "uptime":        uptime,
        "cpu_temp":      temp,
        "pipeline":      "running" if pipeline else "stopped",
        "motion_frames": _motion_frame_count,
        "motion_clients": motion.listener_count,
    }


@api.post("/api/trigger")
async def post_trigger(request: Request):
    """Manually fire an event (for testing without a camera)."""
    data       = await request.json()
    event_type = data.get("event", "motion")
    motion.notify(event_type)
    return {"ok": True, "event": event_type}


# ── YOLO detection endpoints ──────────────────────────────────────────────────

@api.get("/api/detections")
async def get_detections():
    """Return latest detection results as JSON."""
    with _detections_lock:
        dets = list(_latest_detections)
    return {"detections": dets, "model": cfg.get("yolo_engine", ""), "enabled": cfg.get("yolo_enabled", True)}


@api.get("/api/detection/config")
async def get_detection_config():
    return {
        "enabled":   cfg.get("yolo_enabled",   True),
        "threshold": cfg.get("yolo_threshold",  0.40),
        "engine":    cfg.get("yolo_engine",     ""),
        "loaded":    _yolo_model is not None,
    }


@api.post("/api/detection/config")
async def post_detection_config(request: Request):
    data = await request.json()
    if "enabled" in data:
        cfg["yolo_enabled"] = bool(data["enabled"])
    if "threshold" in data:
        th = float(data["threshold"])
        cfg["yolo_threshold"] = max(0.05, min(0.99, th))
        with _yolo_lock:
            if _yolo_model is not None:
                _yolo_model.score_threshold = cfg["yolo_threshold"]
    save_config()
    return {"ok": True, **cfg}


# ── Serve built React frontend (SPA) ─────────────────────────────────────────

if DIST_DIR.exists():
    _assets = DIST_DIR / "assets"
    if _assets.exists():
        api.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    @api.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        target = DIST_DIR / full_path
        if target.exists() and target.is_file():
            return FileResponse(str(target))
        return FileResponse(str(DIST_DIR / "index.html"))


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    global _gst_args

    parser = argparse.ArgumentParser(description="SMART Home Security Backend")
    parser.add_argument("--host",       default="0.0.0.0")
    parser.add_argument("--port",       type=int, default=8000)
    parser.add_argument("--sensor-id",  type=int, default=0)
    parser.add_argument("--i2c-bus",    type=int, default=7)
    parser.add_argument("--stun",       default="stun://stun.l.google.com:19302")
    args     = parser.parse_args()
    _gst_args = args

    cfg["sensor_id"] = args.sensor_id
    cfg["i2c_bus"]   = args.i2c_bus

    Gst.init(None)

    # GLib main loop in a daemon thread — drives all GStreamer async signals
    glib_loop = GLib.MainLoop()
    threading.Thread(target=glib_loop.run, daemon=True, name="glib-main").start()

    # Detect local IP for the startup banner
    import socket as _sock
    try:
        s = _sock.socket(_sock.AF_INET, _sock.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        ip = "localhost"

    print(f"[SERVER] Starting  http://{ip}:{args.port}", flush=True)

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
