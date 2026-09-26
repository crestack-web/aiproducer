"""
AP Reference Mastering microservice.

Runs Matchering 2.0 (GPL-3.0) in isolation. The main AP Studio codebase only
calls this over HTTP — no GPL code is linked into the Node/Next app.

Internal use only: put behind private network / allowlist.
"""
from __future__ import annotations

import io
import os
import tempfile
import threading
import time
import uuid
from typing import Any, Dict, Optional

import httpx
import matchering as mg
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI(title="AP Reference Master", version="1.0.0")

JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
TTL_SEC = int(os.environ.get("REF_MASTER_JOB_TTL_SEC", "3600"))
MAX_BYTES = int(os.environ.get("REF_MASTER_MAX_BYTES", str(80 * 1024 * 1024)))


def _cleanup() -> None:
    now = time.time()
    with JOBS_LOCK:
        dead = [k for k, v in JOBS.items() if now - v.get("created_at", now) > TTL_SEC]
        for k in dead:
            path = JOBS[k].get("result_path")
            if path and os.path.isfile(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
            JOBS.pop(k, None)


def _download(url: str) -> bytes:
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        data = r.content
        if len(data) > MAX_BYTES:
            raise ValueError("audio too large")
        return data


def _run_matchering(target: bytes, reference: bytes, out_path: str) -> None:
    with tempfile.TemporaryDirectory() as td:
        t_path = os.path.join(td, "target.wav")
        r_path = os.path.join(td, "reference.wav")
        with open(t_path, "wb") as f:
            f.write(target)
        with open(r_path, "wb") as f:
            f.write(reference)
        # Matchering writes WAV to result
        mg.process(
            target=t_path,
            reference=r_path,
            results=[
                mg.Result(out_path, subtype="PCM_16"),
            ],
        )


def _worker(job_id: str, target: bytes, reference: bytes) -> None:
    try:
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "processing"
        fd, out_path = tempfile.mkstemp(suffix=".wav", prefix=f"refmaster-{job_id}-")
        os.close(fd)
        _run_matchering(target, reference, out_path)
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "done"
            JOBS[job_id]["result_path"] = out_path
            JOBS[job_id]["error"] = None
    except Exception as e:  # noqa: BLE001
        with JOBS_LOCK:
            JOBS[job_id]["status"] = "failed"
            JOBS[job_id]["error"] = str(e)[:500]


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "reference-master"}


@app.post("/master")
async def master(
    target_audio_url: Optional[str] = Form(None),
    reference_audio_url: Optional[str] = Form(None),
    target_file: Optional[UploadFile] = File(None),
    reference_file: Optional[UploadFile] = File(None),
) -> JSONResponse:
    _cleanup()
    try:
        if target_file is not None:
            target = await target_file.read()
        elif target_audio_url:
            target = _download(target_audio_url)
        else:
            raise HTTPException(400, "target_audio_url or target_file required")

        if reference_file is not None:
            reference = await reference_file.read()
        elif reference_audio_url:
            reference = _download(reference_audio_url)
        else:
            raise HTTPException(400, "reference_audio_url or reference_file required")

        if not target or not reference:
            raise HTTPException(400, "empty audio")
        if len(target) > MAX_BYTES or len(reference) > MAX_BYTES:
            raise HTTPException(413, "audio too large")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"could not load audio: {e}") from e

    job_id = str(uuid.uuid4())
    with JOBS_LOCK:
        JOBS[job_id] = {
            "status": "queued",
            "created_at": time.time(),
            "result_path": None,
            "error": None,
        }
    threading.Thread(target=_worker, args=(job_id, target, reference), daemon=True).start()
    return JSONResponse({"job_id": job_id, "status": "queued"})


@app.get("/master/{job_id}")
def master_status(job_id: str) -> dict:
    _cleanup()
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return {
        "job_id": job_id,
        "status": job["status"],
        "error": job.get("error"),
        "result_ready": job["status"] == "done" and bool(job.get("result_path")),
    }


@app.get("/master/{job_id}/result")
def master_result(job_id: str) -> FileResponse:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    if job["status"] != "done" or not job.get("result_path"):
        raise HTTPException(409, f"not ready: {job['status']}")
    return FileResponse(
        job["result_path"],
        media_type="audio/wav",
        filename=f"matched-{job_id}.wav",
    )
