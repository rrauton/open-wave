from __future__ import annotations

import importlib.metadata
import json
import os
import secrets
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import uuid
import wave
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = Path(os.environ.get("OPEN_WAVE_WEB_ROOT", ROOT / "dist"))
MAX_UPLOAD = 1024 * 1024 * 1024
jobs: dict[str, dict] = {}
lock = threading.Lock()
@asynccontextmanager
async def lifespan(app):
    yield
    cleanup()

app = FastAPI(title="Open Wave Demucs Companion", docs_url=None, redoc_url=None, lifespan=lifespan)


def update(job_id: str, **values) -> None:
    with lock:
        if job_id in jobs:
            jobs[job_id].update(values)


def wav_level(path: Path) -> float:
    with wave.open(str(path), "rb") as source:
        width = source.getsampwidth()
        frames = source.readframes(source.getnframes())
    if width != 2 or not frames:
        return 1.0
    samples = memoryview(frames).cast("h")
    stride = max(1, len(samples) // 100000)
    return max((abs(samples[i]) for i in range(0, len(samples), stride)), default=0) / 32768


def build_bundle(stem_paths: list[Path], target: Path) -> None:
    payloads = []
    metadata = {"stems": []}
    for stem in stem_paths:
        if wav_level(stem) < 0.00001:
            raise RuntimeError(f"Demucs returned a silent {stem.stem} stem")
        data = stem.read_bytes()
        payloads.append(data)
        metadata["stems"].append({"name": stem.stem, "length": len(data)})
    header = json.dumps(metadata, separators=(",", ":")).encode("utf-8")
    with target.open("wb") as output:
        output.write(struct.pack("<I", len(header)))
        output.write(header)
        for payload in payloads:
            output.write(payload)


def demucs_process(job_id: str, command: list[str]) -> tuple[int, str]:
    recent: deque[str] = deque(maxlen=24)
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    with lock:
        if jobs[job_id].get("status") == "cancelled":
            process.terminate()
        jobs[job_id]["process"] = process
    assert process.stdout is not None
    for line in process.stdout:
        clean = line.strip()
        if clean:
            recent.append(clean)
        match = re.search(r"(\d{1,3})%", line)
        if match:
            percent = min(98, max(2, int(match.group(1))))
            update(job_id, progress=percent, message=f"Separating with Demucs… {percent}%")
    return process.wait(), "\n".join(recent)


def useful_error(log: str, code: int) -> str:
    lines = [line for line in log.splitlines() if line and not line.startswith(("File ", "Traceback"))]
    detail = " | ".join(lines[-5:])
    return detail[-1400:] if detail else f"Demucs stopped with error code {code}"


def run_job(job_id: str, source: Path, mode: str, workspace: Path) -> None:
    output = workspace / "separated"
    command = ([sys.executable, "--demucs"] if getattr(sys, "frozen", False) else [sys.executable, "-m", "demucs"]) + ["-n", "htdemucs", "--out", str(output)]
    if mode == "two":
        command.append("--two-stems=vocals")
    command.append(str(source))
    update(job_id, status="running", progress=2, message="Loading the Demucs model…")
    try:
        code, log = demucs_process(job_id, command)
        if jobs.get(job_id, {}).get("status") == "cancelled":
            return
        if code and any(term in log.lower() for term in ("cuda", "cudnn", "out of memory")):
            update(job_id, progress=2, message="GPU processing failed; retrying safely on CPU…")
            code, log = demucs_process(job_id, command[:-1] + ["-d", "cpu", command[-1]])
        if jobs.get(job_id, {}).get("status") == "cancelled":
            return
        if code:
            raise RuntimeError(useful_error(log, code))
        stem_folder = output / "htdemucs" / source.stem
        names = ["vocals", "no_vocals"] if mode == "two" else ["vocals", "drums", "bass", "other"]
        stems = [stem_folder / f"{name}.wav" for name in names]
        missing = [stem.name for stem in stems if not stem.exists()]
        if missing:
            raise RuntimeError("Missing Demucs output: " + ", ".join(missing))
        bundle = workspace / "stems.pulse"
        build_bundle(stems, bundle)
        update(job_id, status="complete", progress=100, message="Demucs separation complete.", result=bundle, process=None)
    except Exception as error:
        update(job_id, status="failed", error=str(error), message="Demucs separation failed.", process=None)


@app.get("/api/health")
def health():
    try:
        import numpy
        import torch
        import demucs.separate
        version = importlib.metadata.version("demucs")
        return {"ready": True, "version": version, "numpy": numpy.__version__, "torch": torch.__version__}
    except Exception as error:
        return {"ready": False, "version": None, "error": f"{type(error).__name__}: {error}"}


@app.post("/api/jobs")
async def create_job(audio: UploadFile = File(...), mode: str = Form("two")):
    if any(j.get("status") in {"running", "queued"} for j in jobs.values()):
        raise HTTPException(409, "A separation job is already running")
    if mode not in {"two", "four"}:
        raise HTTPException(400, "Unsupported stem mode")
    data = await audio.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Audio file is too large")
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise HTTPException(400, "Open Wave must send a WAV file")
    workspace = Path(tempfile.mkdtemp(prefix="pulse-demucs-"))
    source = workspace / "mix.wav"
    source.write_bytes(data)
    job_id = uuid.uuid4().hex
    jobs[job_id] = {"id": job_id, "status": "queued", "progress": 1, "message": "Queued…", "workspace": workspace, "process": None}
    threading.Thread(target=run_job, args=(job_id, source, mode, workspace), daemon=True).start()
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown Demucs job")
    return {key: job.get(key) for key in ("id", "status", "progress", "message", "error")}


@app.get("/api/jobs/{job_id}/result")
def get_result(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown Demucs job")
    if job.get("status") != "complete" or not job.get("result"):
        raise HTTPException(409, "Demucs result is not ready")
    return FileResponse(job["result"], media_type="application/x-pulse-stems", filename="pulse-stems.bin")


@app.delete("/api/jobs/{job_id}")
def cancel_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown Demucs job")
    process = job.get("process")
    if process and process.poll() is None:
        process.terminate()
    update(job_id, status="cancelled", message="Separation cancelled.", process=None)
    return {"cancelled": True}


def cleanup():
    for job in jobs.values():
        process = job.get("process")
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        workspace = job.get("workspace")
        if workspace:
            shutil.rmtree(workspace, ignore_errors=True)


@app.middleware("http")
async def local_access(request, call_next):
    token = os.environ.get("OPEN_WAVE_TOKEN", "")
    if not token or not secrets.compare_digest(request.headers.get("x-open-wave-token", ""), token):
        return JSONResponse({"detail": "Open Open Wave through the desktop app"}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response

app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="pulse-daw")
