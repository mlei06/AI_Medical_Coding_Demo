import logging
import os
from pathlib import Path
from typing import List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from utils.PLM_explainer_service import EXPLAIN_METHODS, predict_explain as run_prediction
from utils.llm_explainer import LLMGenerationError, predict_codes_with_llm

BASE_DIR = Path(__file__).resolve().parent

# Initialize model path
def find_model_path():
    roberta_found = False
    model_path = None
    models_dir = BASE_DIR / "models"
    if not models_dir.exists():
        return roberta_found, model_path

    for model in os.listdir(models_dir):
        if model == "roberta-base-pm-m3-voc-hf":
            roberta_found = True
        else:
            if model != "README.md":
                model_path = model
    return roberta_found, model_path

# Initialize model path 
roberta_found, model_path = find_model_path()
default_model = None
if not roberta_found:
    print("roberta-base-pm-m3-voc-hf not found")
elif not model_path:
    print("No additional model directories found. Requests must supply `model`.")
else:
    default_model = os.path.join("models", model_path)
    print(f"Using default model: {default_model}")

app = FastAPI()

class PredictRequest(BaseModel):
    note: str
    explain_method: Optional[str] = "grad_attention"
    model: Optional[str] = None
    confidence_threshold: Optional[float] = 0.5


class LlmOptions(BaseModel):
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    max_output_tokens: Optional[int] = Field(default=None, ge=1, le=4096)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=4096)
    max_completion_tokens: Optional[int] = Field(default=None, ge=1, le=4096)
    presence_penalty: Optional[float] = Field(default=None, ge=-2.0, le=2.0)
    frequency_penalty: Optional[float] = Field(default=None, ge=-2.0, le=2.0)
    reasoning_effort: Optional[str] = Field(default=None)
    model_config = ConfigDict(extra="forbid")


class LlmPredictRequest(BaseModel):
    note: str
    model_name: Optional[str] = Field(default=None, alias="model")
    icd_version: Optional[str] = Field(default="9", description="ICD version: '9' or '10'")
    options: Optional[LlmOptions] = None

    model_config = ConfigDict(populate_by_name=True)

logger = logging.getLogger(__name__)

BLACKLISTED_MODELS = {"roberta-base-pm-m3-voc-hf", "README.md"}

def discover_models() -> List[str]:
    """Return model directories suitable for selection in the UI."""
    models_root = BASE_DIR / "models"
    if not models_root.exists():
        return []

    discovered = set()
    for path in models_root.rglob("*"):
        if not path.is_dir():
            continue
        if path.name in BLACKLISTED_MODELS:
            continue
        if path == models_root:
            continue
        try:
            has_files = any(child.is_file() for child in path.iterdir())
        except PermissionError:
            has_files = False
        if not has_files:
            continue
        rel_path = Path("models") / path.relative_to(models_root)
        discovered.add(rel_path.as_posix())

    return sorted(discovered)

@app.post("/predict-explain")
def predict_explain(body: PredictRequest):
    if not roberta_found:
        return {
            "error": "Model not initialized. Check that roberta-base-pm-m3-voc-hf exists in models/."
        }

    requested_model = body.model or default_model
    if requested_model is None:
        return {
            "error": "No model provided. Add a model directory to models/ or specify `model` in the request body."
        }

    normalized_model = os.path.normpath(requested_model)
    candidate_paths: List[str] = [normalized_model]
    if not os.path.isabs(normalized_model):
        candidate_paths.append(os.path.join("models", normalized_model))

    resolved_model = next((path for path in candidate_paths if os.path.isdir(path)), None)
    if resolved_model is None:
        return {
            "error": f"Model directory '{requested_model}' not found."
        }
    logger.info(f"Explain method: {body.explain_method}")
    logger.info(f"Model: {resolved_model}")
    logger.info(f"Confidence threshold: {body.confidence_threshold}")
    result = run_prediction(
        text=body.note, 
        method=body.explain_method, 
        model=resolved_model,
        confidence_threshold=body.confidence_threshold
    )
    return result


@app.post("/predict-explain-llm")
def predict_explain_with_llm(body: LlmPredictRequest):
    extras = body.options.model_dump(exclude_none=True) if body.options else None
    try:
        result = predict_codes_with_llm(
            note=body.note,
            model_name=body.model_name,
            icd_version=body.icd_version,
            extras=extras,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except LLMGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return result

@app.get("/models")
def list_models():
    """List available model directories."""
    models = discover_models()
    if default_model and default_model not in models:
        models.insert(0, default_model)
    return {"models": models}

@app.get("/explain-methods")
def list_explain_methods():
    """Return supported explanation methods."""
    return {"methods": EXPLAIN_METHODS}


if __name__ == "__main__":
    if not roberta_found:
        print("Failed to initialize model: roberta-base-pm-m3-voc-hf not found")
        exit(1)
    uvicorn.run(app, host="0.0.0.0", port=8084)
