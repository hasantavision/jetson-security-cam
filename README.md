# jetson-security-cam

Real-time home security camera on a **Jetson Nano** with an **ArduCam IMX519**. Streams live video over WebRTC and runs on-device AI body/head/hand detection — no cloud required.

---

## Hardware

| Component | Details |
|---|---|
| SBC | NVIDIA Jetson Nano (JetPack R32.7.1) |
| Camera | ArduCam IMX519 (16MP), sensor-id=0, CAM0 port |
| Focuser | VCM autofocus via I2C (address 0x0C, bus 7) |

---

## Architecture

```
IMX519 camera
    │
    ▼
nvarguscamerasrc (NVMM, NV12)
    │
    ├──[WebRTC branch]──► nvv4l2h264enc ──► rtph264pay ──► webrtcbin ──► browser
    │
    └──[AI branch]──► nvvidconv (GPU, 320×256) ──► appsink
                                                        │
                                        ┌───────────────┴───────────────┐
                                        ▼                               ▼
                                 MotionDetector                   YOLO worker
                                 (~2 FPS, frame-diff)             (~4 FPS, ORT TRT EP)
                                        │                               │
                                        └───────────────┬───────────────┘
                                                        ▼
                                               Socket.IO / SSE ──► browser
```

The GPU downscales frames to 320×256 (the model's native input size) before they reach Python — **no CPU resize needed**.

---

## AI detection

Uses **YOLOX-S body/head/hand** — a lightweight human detection model with baked-in NMS. Classes: `body`, `head`, `hand`.

### Why ORT TRT EP, not native TRT

Counter-intuitively, the ONNX Runtime TensorRT Execution Provider **outperforms** a natively compiled `.engine` file on this device:

| Backend | Median | FPS | Consistency (stdev) |
|---|---|---|---|
| Native TRT `.engine` | 279 ms | 3.6 | 67.6 ms (poor) |
| **ORT TRT EP `.onnx`** | **153 ms** | **6.5** | **20.4 ms (good)** |

ORT TRT EP runs the backbone on TRT (GPU) and NMS on CPU. On a small GPU like the Nano, launching TRT's NMS kernel costs more than sorting 60 boxes on the CPU. Full explanation: [`docs/why-ort-trt-ep-beats-native-trt.md`](docs/why-ort-trt-ep-beats-native-trt.md).

---

## Project structure

```
jetson-security-cam/
├── backend/                   Python backend (FastAPI + GStreamer + AI)
│   ├── server.py              Main server: WebRTC, motion detection, REST API
│   ├── yolox_trt.py           YOLOX inference (native TRT or ORT TRT EP)
│   ├── benchmark_yolo.py      Latency benchmark: native TRT vs ORT TRT EP
│   ├── prebuild_ort_cache.py  Pre-compile ORT TRT EP engine cache
│   └── requirements.txt       Python dependencies
├── src/                       React + TypeScript frontend (Vite)
│   ├── components/
│   ├── hooks/
│   ├── stores/
│   └── styles/
├── models/                    Model files (gitignored — see Setup)
│   └── .gitkeep
├── deploy/                    Deployment helpers
│   ├── smart-home.service     systemd unit file
│   └── start.sh               Quick-start script (jetson_clocks + server)
├── docs/
│   └── why-ort-trt-ep-beats-native-trt.md
├── tests/fixtures/
│   └── person.jpg             Test image for benchmark
├── index.html                 Vite entry point
├── package.json
└── vite.config.ts
```

---

## Setup

### Prerequisites

- NVIDIA Jetson Nano with JetPack R32.7.1
- ArduCam IMX519 camera module connected to CAM0
- Node.js ≥ 16 (for frontend build)
- Python 3.6 (ships with JetPack)

### 1. Clone

```bash
git clone https://github.com/hasantavision/jetson-security-cam.git
cd jetson-security-cam
```

### 2. Camera driver

Install the ArduCam IMX519 kernel module for JetPack R32.7.1, then verify:

```bash
nvgstcapture-1.0 --sensor-id=0
```

### 3. GStreamer plugins

```bash
sudo apt-get install -y gir1.2-gst-plugins-bad-1.0 gstreamer1.0-nice
```

### 4. Python dependencies

```bash
pip3 install -r backend/requirements.txt
```

> **Note:** `onnxruntime-gpu` requires the aarch64 wheel built for JetPack 4.6. If the PyPI wheel doesn't install, download it from the [Jetson Zoo](https://elinux.org/Jetson_Zoo#ONNX_Runtime) and install with `pip3 install <wheel>.whl`.

### 5. Models

Model files are **not tracked in git** (25–100 MB each). Place the active ONNX in `models/`:

```
models/yolox_s_body_head_hand_post_0299_0.4983_1x3x256x320_ir8.onnx
```

Then pre-build the ORT TRT EP engine cache (runs once, ~2–3 min):

```bash
python3 backend/prebuild_ort_cache.py
```

Subsequent server starts load the cached engine in ~20 seconds.

### 6. Frontend

```bash
npm install
npm run build          # outputs to dist/
```

### 7. Run

```bash
bash deploy/start.sh   # jetson_clocks + python3 backend/server.py
```

Or run the server directly:

```bash
python3 backend/server.py --sensor-id 0 --port 8000
```

Open `http://<jetson-ip>:8000` in a browser on the same network.

### 8. Run as a system service

Edit `deploy/smart-home.service` and replace `YOUR_USERNAME` and `/opt/jetson-security-cam` with your actual username and project path, then:

```bash
sudo cp deploy/smart-home.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now smart-home
journalctl -u smart-home -f   # follow logs
```

---

## Configuration

Settings persist in `backend/config.json` (gitignored — generated on first run). Editable live via the UI or REST API.

| Key | Default | Description |
|---|---|---|
| `width` / `height` / `fps` | 1280×720 @ 21 | Stream resolution and framerate |
| `bitrate` | 4000000 | H.264 encoder bitrate (bps) |
| `focus` | 500 | VCM focus position (0–1000) |
| `yolo_enabled` | true | Toggle AI detection on/off |
| `yolo_threshold` | 0.40 | Minimum detection confidence |
| `yolo_engine` | `models/...ir8.onnx` | Model path (`.onnx` or `.engine`) |
| `motion_threshold` | 5000 | Pixel-diff score to trigger motion event |
| `motion_cooldown` | 3.0 | Seconds between motion events |
| `zone` | 80% centre | Motion detection zone (relative 0–1) |

---

## REST API

| Endpoint | Method | Description |
|---|---|---|
| `/api/config` | GET / POST | Read or write full config |
| `/api/focus` | GET / POST | Get or set focus position |
| `/api/color` | GET / POST | Hue / saturation / brightness / contrast |
| `/api/settings` | GET / POST | Resolution, FPS, bitrate |
| `/api/detections` | GET | Latest YOLO detection results |
| `/api/detection/config` | GET / POST | Enable/disable detection, set threshold |
| `/api/events` | GET (SSE) | Server-sent motion / detection events |
| `/api/info` | GET | Uptime, CPU temp, pipeline status |

---

## Benchmark

```bash
python3 backend/benchmark_yolo.py --runs 30 --warmup 5
# or with a custom image:
python3 backend/benchmark_yolo.py --image path/to/image.jpg --runs 30
```

---

## Performance notes

- The GPU tee branch uses `leaky=downstream` queues — AI processing **never stalls the WebRTC stream**
- YOLO runs at ~4 FPS; motion detection at ~2 FPS — independently frame-skipped
- `sio.emit("detections")` fires only when results change — no redundant socket traffic
- GaussianBlur for motion uses `(5, 5)` kernel — sufficient at 320×256, ~17× cheaper than `(21, 21)`
