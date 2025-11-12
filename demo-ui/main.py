from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

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


CODE_DESCRIPTION_FILES: Dict[str, Path] = {
    "icd9": BASE_DIR.parent / "data" / "code_descriptions" / "icd9.json",
    "icd10": BASE_DIR.parent / "data" / "code_descriptions" / "icd10.json",
    "cpt": BASE_DIR.parent / "data" / "code_descriptions" / "cpt.json",
}


@lru_cache(maxsize=4)
def _load_code_descriptions(system: str) -> List[tuple[str, str]]:
    path = CODE_DESCRIPTION_FILES.get(system)
    if path is None:
        raise KeyError(system)
    if not path.exists():
        raise FileNotFoundError(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        items = data.items()
    elif isinstance(data, list):
        items = ((str(entry.get("code", "")), str(entry.get("description", ""))) for entry in data)
    else:
        items = []
    cleaned: List[tuple[str, str]] = []
    for code, description in items:
        code_str = str(code).strip()
        description_str = str(description or "").strip()
        if code_str and description_str:
            cleaned.append((code_str, description_str))
    return cleaned


def _search_code_descriptions(system: str, query: str, limit: int) -> List[Dict[str, str]]:
    entries = _load_code_descriptions(system)
    lowered_query = query.lower()
    tokens = [token for token in re.split(r"\s+", lowered_query) if token]

    ranked: List[tuple[int, str, str]] = []
    for code, description in entries:
        code_lower = code.lower()
        description_lower = description.lower()

        if not tokens:
            match = True
        else:
            match = all(
                token in code_lower or token in description_lower
                for token in tokens
            )
        if not match:
            continue

        if code_lower == lowered_query:
            score = 0
        elif code_lower.startswith(lowered_query):
            score = 1
        elif lowered_query in code_lower:
            score = 2
        elif description_lower.startswith(lowered_query):
            score = 3
        else:
            score = 4

        ranked.append((score, code, description))
        if len(ranked) >= limit * 10:
            break

    ranked.sort(key=lambda item: (item[0], len(item[1]), item[1]))
    top_results = [
        {"code": code, "description": description}
        for _, code, description in ranked[:limit]
    ]
    return top_results


class FinalizedCode(BaseModel):
    code: str
    code_type: Optional[str] = None
    description: Optional[str] = None
    explanation: Optional[str] = None
    probability: Optional[float] = None
    icd_version: Optional[str] = None
    evidence_spans: Optional[List[Dict[str, Any]]] = None

    model_config = ConfigDict(extra="ignore")


class SubmitCodesPayload(BaseModel):
    note_text: str
    note_filename: Optional[str] = None
    output_folder: Optional[str] = None
    old_folder_name: Optional[str] = None  # If provided and different from output_folder, rename the folder
    update_existing: Optional[bool] = False  # If True and output_folder exists, update it instead of creating new
    codes: Optional[List[FinalizedCode]] = None  # Keep for backward compatibility
    icd_codes: Optional[List[FinalizedCode]] = None
    cpt_codes: Optional[List[FinalizedCode]] = None


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


@app.post("/predict-explain-llm")
async def predict_llm(request: Request):
    return await _proxy_request("POST", "predict-explain-llm", request, include_body=True)


@app.get("/description.json")
async def proxy_description(request: Request):
    return await _proxy_request("GET", "description.json", request)


@app.get("/code-search")
async def code_search(system: str, q: str, limit: int = 20):
    system_key = (system or "").lower().strip()
    if system_key not in CODE_DESCRIPTION_FILES:
        raise HTTPException(status_code=400, detail=f"Unsupported code system '{system}'.")

    query = (q or "").strip()
    if not query:
        return {"results": []}

    try:
        limit_value = max(1, min(int(limit), 50))
    except (TypeError, ValueError):
        limit_value = 20

    try:
        matches = _search_code_descriptions(system_key, query, limit_value)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"Code descriptions for '{system_key}' are not available.")
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Unsupported code system '{system}'.")

    return {"results": matches}


@app.post("/submit-codes")
async def submit_codes(payload: SubmitCodesPayload):
    if not payload.note_text.strip():
        raise HTTPException(status_code=400, detail="note_text cannot be empty.")
    
    icd_codes = payload.icd_codes or []
    cpt_codes = payload.cpt_codes or []
    provided_codes = payload.codes or []

    if not provided_codes and not icd_codes and not cpt_codes:
        raise HTTPException(status_code=400, detail="Provide at least one finalized code.")

    proposed_name = payload.note_filename or f"manual-note-{datetime.now():%Y%m%d-%H%M%S}.txt"
    note_path = Path(proposed_name)
    stem = _slugify_name(note_path.stem)
    extension = note_path.suffix or ".txt"

    # Use custom folder name if provided, otherwise use filename stem
    if payload.output_folder and payload.output_folder.strip():
        folder_name = _slugify_name(payload.output_folder.strip())
        if not folder_name:
            folder_name = "output"
    else:
        folder_name = stem

    # Handle folder renaming if old_folder_name is provided
    old_output_dir = None
    if payload.old_folder_name and payload.old_folder_name.strip():
        old_folder_name = _slugify_name(payload.old_folder_name.strip())
        if old_folder_name and old_folder_name != folder_name:
            old_output_dir = OUTPUT_DIR / old_folder_name
            if old_output_dir.exists() and old_output_dir.is_dir():
                # Rename the folder
                output_dir = OUTPUT_DIR / folder_name
                # If new name already exists, append counter
                counter = 1
                while output_dir.exists():
                    output_dir = OUTPUT_DIR / f"{folder_name}-{counter:02d}"
                    counter += 1
                old_output_dir.rename(output_dir)
            else:
                old_output_dir = None
    
    # If we didn't rename, determine the output directory
    if old_output_dir is None:
        output_dir = OUTPUT_DIR / folder_name
        
        # If update_existing is True and folder exists, use it; otherwise create new folder
        if payload.update_existing and output_dir.exists() and output_dir.is_dir():
            # Update existing folder - keep existing folder name
            pass
        else:
            # Create new folder - append counter if folder exists
            counter = 1
            while output_dir.exists():
                output_dir = OUTPUT_DIR / f"{folder_name}-{counter:02d}"
                counter += 1
            output_dir.mkdir(parents=True, exist_ok=True)
    
    # Ensure directory exists (in case update_existing was True but folder was deleted)
    if not output_dir.exists():
        output_dir.mkdir(parents=True, exist_ok=True)

    note_filename = f"{stem}{extension}"
    note_file = output_dir / note_filename
    note_file.write_text(payload.note_text, encoding="utf-8")

    created_files: List[str] = []

    def format_confidence(value: Optional[float]) -> str:
        if value is None:
            return ""
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return ""
        formatted = f"{numeric:.4f}".rstrip("0").rstrip(".")
        return formatted or "0"

    def sanitize_spans(spans: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        sanitized: List[Dict[str, Any]] = []
        if not spans:
            return sanitized
        for span in spans:
            if not isinstance(span, dict):
                continue
            text = span.get("text")
            start = span.get("start")
            end = span.get("end")
            explanation = span.get("explanation")
            span_payload: Dict[str, Any] = {}
            if isinstance(start, (int, float)):
                span_payload["start"] = int(start)
            if isinstance(end, (int, float)):
                span_payload["end"] = int(end)
            if isinstance(text, str):
                span_payload["text"] = text
            if isinstance(explanation, str) and explanation.strip():
                span_payload["explanation"] = explanation
            if span_payload:
                sanitized.append(span_payload)
        return sanitized

    def normalize_icd_version(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip().lower()
        if not text:
            return None
        if text in {"9", "09"}:
            return "9"
        if text in {"10"}:
            return "10"
        if "10" in text:
            return "10"
        if "9" in text:
            return "9"
        return None

    codes_payload: List[Dict[str, Any]] = []

    def extend_codes(entries: List[FinalizedCode], default_type: Optional[str]) -> None:
        for item in entries:
            base_type = (item.code_type or default_type or "").strip().lower()
            if base_type not in {"icd", "cpt"}:
                base_type = default_type if default_type in {"icd", "cpt"} else "icd"
            version = normalize_icd_version(item.icd_version) if base_type == "icd" else None
            codes_payload.append(
                {
                    "code": item.code,
                    "code_type": base_type,
                    "description": item.description or "",
                    "explanation": item.explanation or "",
                    "confidence": format_confidence(item.probability),
                    "icd_version": version,
                    "evidence_spans": sanitize_spans(item.evidence_spans),
                }
            )

    if provided_codes:
        extend_codes(provided_codes, None)
    else:
        extend_codes(icd_codes, "icd")
        extend_codes(cpt_codes, "cpt")

    if not codes_payload:
        raise HTTPException(status_code=400, detail="Provide at least one finalized code.")

    counts = {
        "total": len(codes_payload),
        "icd": sum(1 for entry in codes_payload if entry["code_type"] == "icd"),
        "icd9": sum(
            1
            for entry in codes_payload
            if entry["code_type"] == "icd" and entry.get("icd_version") == "9"
        ),
        "icd10": sum(
            1
            for entry in codes_payload
            if entry["code_type"] == "icd" and entry.get("icd_version") == "10"
        ),
        "icd_unknown": sum(
            1
            for entry in codes_payload
            if entry["code_type"] == "icd" and entry.get("icd_version") not in {"9", "10"}
        ),
        "cpt": sum(1 for entry in codes_payload if entry["code_type"] == "cpt"),
    }

    export_payload = {
        "note_file": note_filename,
        "generated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "counts": counts,
        "codes": codes_payload,
    }

    codes_file = output_dir / "finalized_codes.json"
    codes_file.write_text(json.dumps(export_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    created_files.append(codes_file.name)

    try:
        relative_path = str(output_dir.relative_to(BASE_DIR))
    except ValueError:
        relative_path = str(output_dir)

    return {
        "message": "Codes saved successfully.",
        "output_path": relative_path,
        "note_file": note_filename,
        "codes_file": codes_file.name,
        "counts": counts,
        "created_files": created_files,
    }


@app.get("/output-folders")
async def list_output_folders() -> Dict[str, Any]:
    """List all folders in the output directory."""
    folders = []
    if not OUTPUT_DIR.exists():
        return {"folders": []}
    
    for item in OUTPUT_DIR.iterdir():
        if item.is_dir():
            # Check if this folder has a finalized_codes.json file
            codes_file = item / "finalized_codes.json"
            if codes_file.exists():
                try:
                    # Try to read metadata from the codes file
                    codes_data = json.loads(codes_file.read_text(encoding="utf-8"))
                    note_file = codes_data.get("note_file", "")
                    generated_at = codes_data.get("generated_at", "")
                    counts = codes_data.get("counts", {})
                    folder_name = item.name
                    
                    folders.append({
                        "name": folder_name,
                        "note_file": note_file,
                        "generated_at": generated_at,
                        "code_counts": counts,
                    })
                except (json.JSONDecodeError, KeyError, OSError):
                    # If we can't read the file, still include the folder but with minimal info
                    folders.append({
                        "name": item.name,
                        "note_file": "",
                        "generated_at": "",
                        "code_counts": {},
                    })
    
    # Sort by folder name (most recent first if using timestamp-based names)
    folders.sort(key=lambda x: x["name"], reverse=True)
    
    return {"folders": folders}


@app.get("/output-folder/{folder_name}")
async def get_output_folder(folder_name: str) -> Dict[str, Any]:
    """Get the note and codes from a specific output folder."""
    # Sanitize folder name to prevent directory traversal
    sanitized_name = _slugify_name(folder_name)
    if not sanitized_name or sanitized_name != folder_name:
        raise HTTPException(status_code=400, detail="Invalid folder name.")
    
    folder_path = OUTPUT_DIR / sanitized_name
    if not folder_path.exists() or not folder_path.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found.")
    
    # Load finalized_codes.json
    codes_file = folder_path / "finalized_codes.json"
    if not codes_file.exists():
        raise HTTPException(status_code=404, detail="finalized_codes.json not found in folder.")
    
    try:
        codes_data = json.loads(codes_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to read codes file: {str(e)}")
    
    # Find and load the note file
    note_file_name = codes_data.get("note_file", "")
    note_text = ""
    
    if note_file_name:
        note_file_path = folder_path / note_file_name
        if note_file_path.exists() and note_file_path.is_file():
            try:
                note_text = note_file_path.read_text(encoding="utf-8")
            except OSError:
                # If we can't read the note file, continue with empty note
                pass
    
    # Extract codes from the codes_data
    codes_list = codes_data.get("codes", [])
    
    return {
        "folder_name": sanitized_name,
        "note_text": note_text,
        "note_file": note_file_name,
        "codes": codes_list,
        "generated_at": codes_data.get("generated_at", ""),
        "counts": codes_data.get("counts", {}),
    }


@app.delete("/output-folder/{folder_name}")
async def delete_output_folder(folder_name: str) -> Dict[str, Any]:
    """Delete an output folder and all its contents."""
    # Sanitize folder name to prevent directory traversal
    sanitized_name = _slugify_name(folder_name)
    if not sanitized_name or sanitized_name != folder_name:
        raise HTTPException(status_code=400, detail="Invalid folder name.")
    
    folder_path = OUTPUT_DIR / sanitized_name
    if not folder_path.exists() or not folder_path.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found.")
    
    try:
        # Use shutil to recursively delete the folder
        shutil.rmtree(folder_path)
        return {"message": f"Folder '{sanitized_name}' deleted successfully."}
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete folder: {str(e)}")


@app.delete("/output-folders")
async def delete_all_output_folders() -> Dict[str, Any]:
    """Delete all output folders and their contents."""
    if not OUTPUT_DIR.exists():
        return {"message": "No folders to delete.", "deleted": 0}
    
    deleted = 0
    errors = []
    for item in OUTPUT_DIR.iterdir():
        if item.is_dir():
            try:
                shutil.rmtree(item)
                deleted += 1
            except OSError as exc:
                errors.append(f"{item.name}: {exc}")
    
    if errors:
        joined = "; ".join(errors)
        raise HTTPException(status_code=500, detail=f"Failed to delete some folders: {joined}")
    
    return {
        "message": f"Deleted {deleted} folder{'s' if deleted != 1 else ''}.",
        "deleted": deleted,
    }
