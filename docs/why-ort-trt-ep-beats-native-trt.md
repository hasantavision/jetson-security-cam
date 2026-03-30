# Why the "Slow" Way Was Actually 1.8x Faster: ORT TRT EP vs Native TensorRT on Jetson Nano

*Running AI on a $99 board taught me that "direct" doesn't always mean "fast."*

---

## The setup

I'm building a home security camera on a **Jetson Nano** — a tiny NVIDIA computer the size of a credit card that has a real GPU on it. I wanted it to detect people in real-time using a neural network called **YOLOX-S**, which can find bodies, heads, and hands in a video frame.

The Jetson Nano is not powerful. It has 4GB of RAM and a GPU with 128 CUDA cores. To run AI fast on it, NVIDIA gives you a tool called **TensorRT** — a compiler that takes your AI model and squeezes every bit of performance out of the hardware.

I had two ways to use TensorRT. I assumed one was obviously better. I was wrong.

---

## First, some vocabulary (I promise it's simple)

**AI model**: A file that has learned to recognize things (like humans in a photo). Think of it as a very complicated math formula.

**ONNX** (`.onnx` file): A universal format for AI models. Like a PDF — any program that knows ONNX can open it.

**TensorRT** (TRT): NVIDIA's tool that compiles an AI model specifically for *your* GPU. Like converting a recipe from grams to the exact cups in your cupboard — it runs faster because it's tuned for your exact hardware.

**Engine** (`.engine` file): The compiled output of TensorRT. Pre-cooked and ready to go.

**ONNX Runtime (ORT)**: A separate program that can *run* ONNX models. It supports many backends, including TensorRT.

**TRT EP** (TensorRT Execution Provider): ONNX Runtime's way of saying "hey TensorRT, handle the heavy parts."

**NMS** (Non-Maximum Suppression): After a detection model finds 50 overlapping "person" boxes, NMS picks the best one and throws the rest away. It's the cleanup step.

---

## The two paths I tested

### Path A: Native TensorRT (`trtexec`)

This is the "proper" way everyone recommends. You take your ONNX file, run NVIDIA's official tool called `trtexec`, and it compiles a `.engine` file:

```bash
trtexec --onnx=model.onnx --saveEngine=model.engine --fp16
```

Then you load that `.engine` file directly in your Python code using `pycuda` and run it yourself. No middleman. Direct GPU calls.

I assumed this would be the fastest. You compiled it yourself! Direct hardware access! No wrapper overhead!

### Path B: ORT TRT EP

This is the "lazy" way. You keep the original `.onnx` file and tell ONNX Runtime to use TensorRT under the hood:

```python
providers = [("TensorrtExecutionProvider", {"trt_fp16_enable": True, ...})]
session = onnxruntime.InferenceSession("model.onnx", providers=providers)
```

ONNX Runtime will compile the TRT engine for you automatically, cache it, and reuse it next time. You don't touch `trtexec`. You don't write CUDA code. You just call `session.run()`.

This felt like cheating. Like ordering fast food instead of cooking yourself. Surely slower, right?

---

## The benchmark

I ran both backends 20 times on the same image of a person, measured how long each inference took, and compared:

```
======================================================
Backend A — Native TRT (.engine)
======================================================
  Load time : 48,576 ms   (48 seconds to load)
  Median    : 278.8 ms
  Mean      : 284.5 ms
  Stdev     : 67.6 ms
  Min/Max   : 179.3 / 410.3 ms
  Est FPS   : 3.6

======================================================
Backend B — ORT TRT EP (.onnx + cached engine)
======================================================
  Load time : 20,465 ms   (20 seconds to load)
  Median    : 152.7 ms
  Mean      : 157.9 ms
  Stdev     : 20.4 ms
  Min/Max   : 137.8 / 210.4 ms
  Est FPS   : 6.5

======================================================
Comparison
======================================================
  Speedup (TRT vs ORT) : 0.55x
  (ORT TRT EP is 1.8x faster)
```

The "lazy" path was **1.8 times faster**. And it also loaded **2.4x faster**. And the detections were cleaner. The direct path lost on every metric.

I stared at this for a while.

---

## Why? (The actual explanation)

Here's the thing that made my brain click.

### The model has two parts

This YOLOX-S model is a **"post-processed" model**. That means two steps are baked into the file:

1. **The backbone** — the neural network that looks at the image and says "there are probably people here" (hundreds of overlapping guesses)
2. **NMS (cleanup)** — the step that throws away duplicates and picks the best boxes

When I compiled the whole thing with `trtexec`, both parts ran on the GPU inside TensorRT.

When ONNX Runtime used TRT EP, it was smarter. It split the work:

- **Backbone → TensorRT** (GPU, fast)
- **NMS → CPU** (via ONNX operators, but only has ~60 boxes to sort — takes microseconds)

### Why is NMS faster on CPU here?

TensorRT's NMS kernel is designed for big batches on servers with powerful GPUs. On a Jetson Nano's tiny GPU, the overhead of launching and coordinating that kernel is expensive relative to the tiny amount of work (sorting 60 boxes).

The CPU just does `sort + filter` on 60 numbers. On a modern CPU that's nothing — it runs in under a millisecond. Meanwhile, TRT's NMS kernel has to set up GPU memory, launch warps, synchronize — all for 60 boxes.

It's like hiring a forklift to move a cardboard box. Technically works. Not the right tool.

### Bonus: TRT NMS had a bug on this device

With native TRT on Jetson Nano (TensorRT 8.2), the NMS output buffer wasn't being fully zeroed between inference calls. The leftover garbage from the previous call was being returned as extra detections. This is a known quirk of static NMS output shapes in TRT 8.2.

ORT's CPU NMS doesn't have this problem — it only returns what it finds, nothing extra.

```
Native TRT detections: 6 boxes (2 duplicates — garbage from previous call)
ORT TRT EP detections: 4 boxes (clean)
```

---

## The variance story

Look at the standard deviations:

```
Native TRT : stdev = 67.6 ms  (huge)
ORT TRT EP : stdev = 20.4 ms  (3x more consistent)
```

Native TRT ranged from 179ms to 410ms — more than 2x spread. That means some frames take 410ms which is noticeable lag. ORT TRT EP ranged from 138ms to 210ms. Much more predictable.

For a live camera system, consistency matters more than raw peak speed. A detector that takes 153ms every time feels smoother than one averaging 279ms with wild swings.

---

## "But isn't ORT just adding overhead?"

Yes, ONNX Runtime adds overhead. There's a Python call, some tensor handling, a session dispatch. But that overhead is in the sub-millisecond range. Meanwhile, the NMS kernel difference is in the **50–100ms range**.

A thin wrapper around a faster core beats a direct call to a slower one.

---

## The "instant load" situation

One more thing: I wanted the server to start fast. "Pre-building" the TRT engine is often recommended for this.

Here's what "pre-built" actually means for each backend:

**Native TRT**: compile with `trtexec` → save `.engine` file. Load time on Nano: **~48 seconds** (deserializing the engine into CUDA memory).

**ORT TRT EP**: first run compiles and saves a cache automatically (the `TensorrtExecutionProvider_TRTKernel_*.engine` files in your model dir). Load time on Nano with warm cache: **~20 seconds**.

Both require a one-time compile. ORT's cached load is still faster.

Pre-building for ORT EP is a one-liner:

```bash
python3 backend/prebuild_ort_cache.py
```

Run it once after installing or upgrading JetPack. The server will find the cache and skip recompilation every time after that.

---

## Practical takeaway

If you're running YOLOX (or similar post-processed ONNX detection models) on an **edge GPU like Jetson Nano**:

- Don't assume `trtexec` + native TRT is the fastest path
- ORT TRT EP splits backbone and NMS intelligently
- The NMS running on CPU is actually a feature, not a bug
- Pre-build the ORT cache once so startup is fast
- Benchmark both — the result may surprise you

The rule of thumb: **if your model has a built-in NMS operator and you're on a small GPU, ORT TRT EP is likely faster and cleaner.**

---

## Benchmark code

The full benchmark script is at [`backend/benchmark_yolo.py`](../backend/benchmark_yolo.py). Run it yourself:

```bash
python3 backend/benchmark_yolo.py --image your_photo.jpg --runs 30 --warmup 5
```

The pre-build script is at [`backend/prebuild_ort_cache.py`](../backend/prebuild_ort_cache.py).

---

## Numbers at a glance

| | Native TRT | ORT TRT EP |
|---|---|---|
| Median inference | 279 ms | **153 ms** |
| Estimated FPS | 3.6 | **6.5** |
| Latency stdev | 67.6 ms | **20.4 ms** |
| Load time (cached) | 48 s | **20 s** |
| Detection quality | Duplicates | **Clean** |
| NMS runs on | TRT (GPU) | **CPU (fast here)** |

Hardware: Jetson Nano, JetPack R32.7.1, TensorRT 8.2.0, onnxruntime-gpu, Python 3.6.9.
Model: YOLOX-S body/head/hand 256×320 FP16.
