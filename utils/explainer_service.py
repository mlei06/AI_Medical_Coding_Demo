"""
Utilities for running medical code predictions and explanations.

"""

from __future__ import annotations

import json
import logging
import sys
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple, Union

import torch
from omegaconf import OmegaConf
from transformers import AutoTokenizer

MODULE_ROOT = Path(__file__).resolve().parent
if str(MODULE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODULE_ROOT))

from explainable_medical_coding.config.factories import get_explainability_method
from explainable_medical_coding.utils.analysis import predict
from explainable_medical_coding.utils.loaders import load_trained_model
from explainable_medical_coding.utils.tokenizer import (
    TargetTokenizer,
    get_tokens,
    token_ids_to_spans,
)


logger = logging.getLogger(__name__)

# Centralise supported explainability methods so the API and CLI stay in sync.
EXPLAIN_METHODS: List[str] = [
    "laat",
    "attention_rollout",
    "gradient_x_input",
    "integrated_gradient",
    "deeplift",
    "grad_attention",
    "atgrad_attention",
    "random",
    "occlusion",
    "kernelshap",
    "lime",
]

# Cache loaded explainers by resolved model path to avoid reloading on every call.
_EXPLAINER_CACHE: Dict[Tuple[Path, Optional[str]], "MedicalCodeExplainer"] = {}


def _resolve_model_path(model_path: Union[str, Path]) -> Path:
    path = Path(model_path)
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def get_cached_explainer(
    model_path: Union[str, Path],
    device: Optional[str] = None,
) -> "MedicalCodeExplainer":
    """Return a cached ``MedicalCodeExplainer`` for the given configuration."""
    resolved_model_path = _resolve_model_path(model_path)
    cache_key = (resolved_model_path, device)

    if cache_key not in _EXPLAINER_CACHE:
        logger.info(
            "Initializing MedicalCodeExplainer for model '%s' on device '%s'",
            resolved_model_path,
            device or "auto",
        )
        _EXPLAINER_CACHE[cache_key] = MedicalCodeExplainer(
            model_path=str(resolved_model_path),
            device=device,
        )
    return _EXPLAINER_CACHE[cache_key]


def convert_to_json_serializable(obj):
    """Convert numpy / torch types to native Python types for JSON serialization."""
    import numpy as np

    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, (np.ndarray, torch.Tensor)):
        return obj.tolist()
    if isinstance(obj, dict):
        return {key: convert_to_json_serializable(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [convert_to_json_serializable(item) for item in obj]
    return obj


@lru_cache(maxsize=4)
def load_description_dict(path: Union[str, Path] = "data/description.json") -> Dict[str, str]:
    """Load the ICD code description dictionary if available."""
    try:
        data = Path(path)
        if not data.exists():
            logger.warning("description.json not found at %s", data)
            return {}
        return json.loads(data.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse description.json: %s", exc)
        return {}


class MedicalCodeExplainer:
    """Predict medical codes and generate token-level explanations."""

    def __init__(
        self,
        model_path: Union[str, Path] = "models/unsupervised/gice8s68",
        device: Optional[str] = None,
    ):
        self.model_path = _resolve_model_path(model_path)
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._load_model_components()

    def _load_model_components(self) -> None:
        config_path = self.model_path / "config.yaml"
        if not config_path.exists():
            raise FileNotFoundError(f"Config file not found: {config_path}")

        self.config = OmegaConf.load(config_path)

        target_tokenizer_path = self.model_path / "target_tokenizer.json"
        if not target_tokenizer_path.exists():
            raise FileNotFoundError(f"Target tokenizer not found: {target_tokenizer_path}")

        self.target_tokenizer = TargetTokenizer(autoregressive=False)
        self.target_tokenizer.load(target_tokenizer_path)

        text_tokenizer_path = self.config.model.configs.model_path
        self.text_tokenizer = AutoTokenizer.from_pretrained(text_tokenizer_path)

        self.model, self.decision_boundary = load_trained_model(
            experiment_path=self.model_path,
            config=self.config,
            pad_token_id=self.text_tokenizer.pad_token_id,
            device=self.device,
        )

        self.max_length = getattr(self.config.data, "max_length", 6000)

    def predict_codes(
        self,
        text: str,
        decision_boundary: Optional[float] = None,
        top_k: Optional[int] = None,
        return_probabilities: bool = True,
    ) -> Dict:
        if decision_boundary is None:
            decision_boundary = self.decision_boundary

        inputs = self.text_tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=self.max_length,
            padding=False,
        )

        input_ids = inputs["input_ids"]
        probabilities = predict(self.model, input_ids, self.device).squeeze()

        if top_k:
            top_k_probs, top_k_indices = torch.topk(probabilities, min(top_k, len(probabilities)))
            predicted_indices = top_k_indices.tolist()
            predicted_probs = top_k_probs.tolist()
        else:
            binary_predictions = probabilities > decision_boundary
            predicted_indices = torch.where(binary_predictions)[0].tolist()
            predicted_probs = probabilities[predicted_indices].tolist()

        predicted_codes = [self.target_tokenizer.id2target[idx] for idx in predicted_indices]

        result = {
            "input_text": text,
            "predicted_codes": predicted_codes,
            "predicted_indices": predicted_indices,
            "num_predicted_codes": len(predicted_codes),
            "decision_boundary": decision_boundary,
        }

        if return_probabilities:
            result["code_probabilities"] = dict(zip(predicted_codes, predicted_probs))

        return result

    def explain_predictions(
        self,
        text: str,
        explanation_method: str = "laat",
        decision_boundary: Optional[float] = None,
        top_k_codes: Optional[int] = None,
        top_k_tokens: int = 10,
        return_spans: bool = True,
    ) -> Dict:
        if decision_boundary is None:
            decision_boundary = self.decision_boundary

        predictions = self.predict_codes(
            text,
            decision_boundary=decision_boundary,
            top_k=top_k_codes,
            return_probabilities=True,
        )

        if len(predictions["predicted_codes"]) == 0:
            return {
                **predictions,
                "explanations": {},
                "explanation_method": explanation_method,
                "message": "No codes predicted above threshold",
            }

        inputs = self.text_tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=self.max_length,
            padding=False,
        )

        input_ids = inputs["input_ids"].to(self.device)

        try:
            explainer_factory = get_explainability_method(explanation_method)
            explainer = explainer_factory(
                model=self.model,
                baseline_token_id=self.text_tokenizer.mask_token_id,
                cls_token_id=self.text_tokenizer.cls_token_id,
                eos_token_id=self.text_tokenizer.eos_token_id,
            )
        except Exception as exc:  # pragma: no cover - depends on external library state
            return {
                **predictions,
                "error": f"Failed to initialize explainer '{explanation_method}': {exc}",
                "available_methods": EXPLAIN_METHODS,
            }

        target_indices = torch.tensor(predictions["predicted_indices"])

        try:
            attributions = explainer(
                input_ids=input_ids,
                target_ids=target_indices,
                device=self.device,
            ).cpu()
        except Exception as exc:  # pragma: no cover - depends on external library state
            return {
                **predictions,
                "error": f"Failed to generate explanations: {exc}",
            }

        tokens = get_tokens(input_ids.squeeze().cpu(), self.text_tokenizer)
        explanations = {}

        probabilities = list(predictions.get("code_probabilities", {}).values())
        for code_idx, (code, prob) in enumerate(
            zip(predictions["predicted_codes"], probabilities)
        ):
            code_attributions = attributions[:, code_idx]

            top_values, top_indices = torch.topk(
                torch.abs(code_attributions),
                min(top_k_tokens, len(code_attributions)),
            )

            token_explanations = []
            important_token_ids: List[int] = []

            for rank, (token_idx_tensor, attribution_value) in enumerate(
                zip(top_indices, top_values)
            ):
                token_idx = int(token_idx_tensor)
                if token_idx >= len(tokens):
                    continue

                raw_token = tokens[token_idx]
                clean_token = raw_token.replace("Ġ", " ").replace("Ċ", "\\n")

                token_explanations.append(
                    {
                        "rank": rank + 1,
                        "token": raw_token,
                        "token_display": clean_token,
                        "attribution": float(attribution_value),
                        "token_id": token_idx,
                    }
                )
                important_token_ids.append(token_idx)

            explanation_data = {
                "code": code,
                "probability": float(prob),
                "explanation_method": explanation_method,
                "top_tokens": token_explanations,
                "all_attributions": code_attributions.tolist(),
            }

            if return_spans and important_token_ids:
                try:
                    spans = token_ids_to_spans(
                        input_ids.squeeze().cpu(),
                        torch.tensor(important_token_ids),
                        self.text_tokenizer,
                    )
                    span_texts = []
                    for start_char, end_char in spans:
                        span_texts.append(
                            {
                                "text": text[start_char:end_char],
                                "start": int(start_char),
                                "end": int(end_char),
                            }
                        )
                    explanation_data["important_spans"] = span_texts
                except Exception as exc:  # pragma: no cover - conversion is best-effort
                    explanation_data["span_error"] = f"Could not convert to spans: {exc}"

            explanations[code] = explanation_data

        return {
            **predictions,
            "explanations": explanations,
            "explanation_method": explanation_method,
            "tokens": tokens,
            "total_tokens": len(tokens),
        }


def format_output(results: Dict, verbose: bool = False) -> str:
    """Format explainability results for human readable display."""
    output = []
    output.append("=" * 80)
    output.append("MEDICAL CODE PREDICTION AND EXPLANATION")
    output.append("=" * 80)

    text = results.get("input_text", "")
    if len(text) > 200:
        text = text[:200] + "..."
    output.append(f"Input Text: {text}")
    output.append("")

    if "error" in results:
        output.append(f"Error: {results['error']}")
        if "available_methods" in results:
            output.append(f"Available methods: {', '.join(results['available_methods'])}")
        return "\n".join(output)

    output.append(f"Predicted {results.get('num_predicted_codes', 0)} medical codes "
                  f"(threshold: {results.get('decision_boundary', 0.0):.4f}):")
    if "code_probabilities" in results:
        for code, prob in results["code_probabilities"].items():
            output.append(f"  - {code}: {prob:.4f}")
    else:
        for code in results.get("predicted_codes", []):
            output.append(f"  - {code}")

    explanations = results.get("explanations", {})
    if explanations:
        output.append("")
        output.append(f"Explanations (method: {results.get('explanation_method', 'unknown')}):")
        for code, explanation in explanations.items():
            output.append(f"\n--- {code} (probability: {explanation.get('probability', 0.0):.4f}) ---")
            output.append("Most important tokens:")
            for token_info in explanation.get("top_tokens", [])[:5]:
                display_token = token_info.get("token_display", token_info.get("token", ""))
                output.append(
                    f"  {token_info.get('rank', 0)}. '{display_token}' "
                    f"(score: {token_info.get('attribution', 0.0):.4f})"
                )
            for span in explanation.get("important_spans", []):
                output.append(
                    f"  span \"{span.get('text', '')}\" "
                    f"[{span.get('start', 0)}-{span.get('end', 0)}]"
                )
            if verbose and "all_attributions" in explanation:
                tokens = results.get("tokens", [])
                for idx, (token, attr) in enumerate(
                    zip(tokens, explanation["all_attributions"])
                ):
                    if abs(attr) > 0.001:
                        output.append(f"  {idx:3d}. {token:15s} {attr:8.4f}")

    return "\n".join(output)


def _filter_explanations_by_confidence(
    explanations: Dict[str, Dict],
    confidence_threshold: float,
) -> Dict[str, Dict]:
    return {
        code: explanation
        for code, explanation in explanations.items()
        if explanation.get("probability", 0.0) >= confidence_threshold
    }


def _build_icd_response(
    explanations: Dict[str, Dict],
    description_dict: Dict[str, str],
) -> List[Dict]:
    icd_codes: List[Dict] = []
    for code, explanation in explanations.items():
        spans = [
            {
                "text": span.get("text", ""),
                "start": span.get("start", 0),
                "end": span.get("end", 0),
            }
            for span in explanation.get("important_spans", [])
        ]
        tokens = [
            {
                "token": token_info.get("token_display", token_info.get("token", "")),
                "rank": token_info.get("rank", 0),
                "attribution": token_info.get("attribution", 0.0),
            }
            for token_info in explanation.get("top_tokens", [])
        ]

        unformatted = code.replace(".", "")
        description = description_dict.get(unformatted, "")
        icd_codes.append(
            {
                "code": code,
                "description": description,
                "probability": explanation.get("probability", 0.0),
                "explanation": {
                    "spans": spans,
                    "tokens": tokens,
                },
            }
        )
    return icd_codes


def predict_explain(
    text: Optional[str],
    method: str = "grad_attention",
    model: Optional[str] = "models/unsupervised/gice8s68",
    confidence_threshold: float = 0.5,
    top_k_codes: int = 10,
    top_k_tokens: int = 5,
    return_spans: bool = True,
) -> Dict:
    if not text:
        return {
            "error": "Input text is empty. Provide clinical note text in `text`.",
        }
    if not model:
        return {
            "error": "Model path is required for prediction.",
        }

    if method not in EXPLAIN_METHODS:
        logger.warning("Requested explanation method '%s' is not in the supported list", method)

    try:
        explainer = get_cached_explainer(model_path=model, device=None)
    except Exception as exc:
        logger.exception("Failed to initialize explainer")
        return {"error": str(exc)}

    results = explainer.explain_predictions(
        text=text,
        explanation_method=method,
        top_k_codes=top_k_codes,
        top_k_tokens=top_k_tokens,
        return_spans=return_spans,
    )

    if "error" in results:
        return results

    explanations = results.get("explanations", {})
    filtered = _filter_explanations_by_confidence(explanations, confidence_threshold)
    results["explanations"] = filtered
    results["num_predicted_codes"] = len(filtered)

    description_dict = load_description_dict()
    icd_codes = _build_icd_response(filtered, description_dict)

    formatted_results = {
        "cpt_codes": None,
        "icd_codes": icd_codes,
    }

    return convert_to_json_serializable(formatted_results)
