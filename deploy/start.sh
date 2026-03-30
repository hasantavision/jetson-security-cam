#!/bin/bash
# SMART Home Security — Startup Script
# Activates jetson_clocks for maximum CPU/GPU clocks and launches the backend.

set -euo pipefail

# Resolve project root: one level up from this script's deploy/ directory
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[SMART] Activating jetson_clocks for maximum performance..."
sudo jetson_clocks

echo "[SMART] Starting backend server from ${PROJECT_DIR}..."
cd "$PROJECT_DIR"
exec python3 backend/server.py --sensor-id 0 --port 8000
