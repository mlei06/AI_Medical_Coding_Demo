from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
UPSTREAM_API_BASE = os.getenv("UPSTREAM_API_BASE", "http://localhost:8084").rstrip("/")

app = FastAPI(title="Explainable Coding Demo Bridge")

if FRONTEND_DIR.exists():
    app.mount("/ui", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="ui")


def _filter_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    hop_by_hop = {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
        "content-length",
    }
    return {k: v for k, v in headers if k.lower() not in hop_by_hop}


def _slugify_name(name: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._-")
    return normalized or "note"


class FinalizedCode(BaseModel):
    code: str
    description: Optional[str] = None
    probability: Optional[float] = None


class SubmitCodesPayload(BaseModel):
    note_text: str
    note_filename: Optional[str] = None
    codes: List[FinalizedCode]


async def _proxy_request(method: str, upstream_path: str, request: Request, *, include_body: bool = False) -> Response:
    if not UPSTREAM_API_BASE:
        raise HTTPException(status_code=500, detail="UPSTREAM_API_BASE is not configured.")

    url = f"{UPSTREAM_API_BASE}/{upstream_path.lstrip('/')}"
    headers = _filter_headers(request.headers.items())

    params = dict(request.query_params)
    content = await request.body() if include_body else None
    timeout = httpx.Timeout(60.0, read=60.0, connect=10.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.request(method, url, params=params, content=content, headers=headers)

    filtered_response_headers = {
        k: v
        for k, v in response.headers.items()
        if k.lower() in {"content-type", "cache-control", "etag"}
    }

    return Response(content=response.content, status_code=response.status_code, headers=filtered_response_headers)


@app.get("/")
async def root():
    if FRONTEND_DIR.exists():
        return RedirectResponse(url="/ui/")
    return {"message": "Demo UI assets not found. Ensure frontend/ exists alongside main.py."}


@app.get("/healthz")
async def health_check():
    return {"status": "ok", "upstream": UPSTREAM_API_BASE}


@app.get("/models")
async def list_models(request: Request):
    return await _proxy_request("GET", "models", request)


@app.get("/explain-methods")
async def list_methods(request: Request):
    return await _proxy_request("GET", "explain-methods", request)


@app.post("/predict-explain")
async def predict(request: Request):
    return await _proxy_request("POST", "predict-explain", request, include_body=True)


@app.get("/description.json")
async def proxy_description(request: Request):
    return await _proxy_request("GET", "description.json", request)


@app.post("/submit-codes")
async def submit_codes(payload: SubmitCodesPayload):
    if not payload.note_text.strip():
        raise HTTPException(status_code=400, detail="note_text cannot be empty.")
    if not payload.codes:
        raise HTTPException(status_code=400, detail="Provide at least one finalized code.")

    proposed_name = payload.note_filename or f"manual-note-{datetime.now():%Y%m%d-%H%M%S}.txt"
    note_path = Path(proposed_name)
    stem = _slugify_name(note_path.stem)
    extension = note_path.suffix or ".txt"

    output_dir = OUTPUT_DIR / stem
    counter = 1
    while output_dir.exists():
        output_dir = OUTPUT_DIR / f"{stem}-{counter:02d}"
        counter += 1
    output_dir.mkdir(parents=True, exist_ok=True)

    note_filename = f"{stem}{extension}"
    note_file = output_dir / note_filename
    note_file.write_text(payload.note_text, encoding="utf-8")

    codes_lines = []
    for idx, code in enumerate(payload.codes, start=1):
        line = f"{idx}. {code.code}"
        if code.description:
            line += f" - {code.description}"
        if code.probability is not None:
            line += f" (probability: {code.probability:.4f})"
        codes_lines.append(line)

    codes_file = output_dir / "finalized_codes.txt"
    codes_file.write_text("\n".join(codes_lines) + "\n", encoding="utf-8")

    try:
        relative_path = str(output_dir.relative_to(BASE_DIR))
    except ValueError:
        relative_path = str(output_dir)

    return {
        "message": "Codes saved successfully.",
        "output_path": relative_path,
        "note_file": note_filename,
        "codes_file": codes_file.name,
    }
