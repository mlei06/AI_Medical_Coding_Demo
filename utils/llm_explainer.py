"""LLM-based ICD/CPT prediction with evidence spans."""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI, OpenAIError

logger = logging.getLogger(__name__)

DEFAULT_LLM_MODEL = os.getenv("LLM_CODING_MODEL", os.getenv("GPT_MODEL", "gpt-5"))
DEFAULT_GPT5_REASONING_EFFORT = os.getenv("GPT5_DEFAULT_REASONING_EFFORT", "minimal").strip().lower()

# Response schema encouraging structured JSON with evidence spans.
LLM_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "json_schema",
    "json_schema": {
        "name": "CodingPrediction",
        "schema": {
            "type": "object",
            "properties": {
                "reasoning": {"type": "string"},
                "icd_codes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "code": {"type": "string"},
                            "description": {"type": "string"},
                            "explanation": {"type": "string"},
                            "evidence_spans": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "text": {"type": "string"},
                                        "explanation": {"type": "string"},
                                    },
                                    "required": ["text", "explanation"],
                                    "additionalProperties": False,
                                },
                                "minItems": 0,
                            },
                        },
                        "required": ["code", "description", "explanation", "evidence_spans"],
                        "additionalProperties": False,
                    },
                },
                "cpt_codes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "code": {"type": "string"},
                            "description": {"type": "string"},
                            "explanation": {"type": "string"},
                            "evidence_spans": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "text": {"type": "string"},
                                        "explanation": {"type": "string"},
                                    },
                                    "required": ["text", "explanation"],
                                    "additionalProperties": False,
                                },
                                "minItems": 0,
                            },
                        },
                        "required": ["code", "description", "explanation", "evidence_spans"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["reasoning", "icd_codes", "cpt_codes"],
            "additionalProperties": False,
        },
    },
}

# Prompt instructing the model to return JSON with explicit evidence spans.
LLM_CODING_PROMPT_ICD9 = """
You are a dual-certified professional coder:
 • Board-certified ICD-9-CM medical coder
 • CPC® specializing in Current Procedural Terminology (CPT®)

Task: From the clinical note below, identify all billable diagnoses and procedures and assign the correct ICD-9-CM and CPT® codes.

ICD-9-CM RULES
• Principal diagnosis first → secondary diagnoses → procedures in chronological order.
• Codes must be 3–5 digits, use the most specific available, no duplicates.

CPT® RULES
• Highest-level E/M or critical-care code first → follow-up visits → procedures in chronological order.
• Use only 5-digit CPT® codes—no modifiers or HCPCS codes.

Workflow:
• Extract all diagnoses, symptom complexes, and procedures/therapies from the note.
• Identify the principal diagnosis, then secondary diagnoses and procedures in the required sequence.
• Assign the most specific valid ICD-9-CM and CPT® codes, applying bundling/edit rules as needed.
• Provide a clear explanation for each code.
• Double-check sequencing, remove duplicates and non-billable items, and ensure no modifiers/HCPCS codes appear.

Evidence requirements:
• For every code, include 1–3 evidence spans that are EXACT verbatim text copied from the note.
• CRITICAL: Evidence spans must match the note text EXACTLY—no quotes, no ellipses (...), no truncation markers, no added formatting.
• Copy the text exactly as written: if the note says "Hypertension", use "Hypertension" (not '"Hypertension"' or 'history of ... Hypertension').
• Prefer shorter, precise phrases (5-30 words) that appear verbatim in the note over longer passages.
• Newlines in the note should be preserved naturally—if the note has "Assessment:\n- Hypertension", copy it exactly including the newline.
• If you cannot find exact matching text in the note for a code, omit that evidence span rather than creating a paraphrase or approximation.
• Pair each evidence span with a brief explanation of why it supports that code.
• If unsure a code applies, omit it.

Return JSON only, matching this structure exactly:
{
  "reasoning": "overall reasoning about sequencing and code selection",
  "icd_codes": [
    {
      "code": "ICD-9-CM code",
      "description": "ICD-9-CM description",
      "explanation": "≤30 words explaining rationale",
      "evidence_spans": [
        {"text": "Assessment:\n- Hypertension", "explanation": "why this text supports the code"}
      ]
    }
  ],
  "cpt_codes": [
    {
      "code": "5-digit CPT code",
      "description": "CPT description",
      "explanation": "≤30 words explaining rationale",
      "evidence_spans": [
        {"text": "Assessment:\n- Hypertension", "explanation": "why this text supports the code"}
      ]
    }
  ]
}
If no codes exist, return empty arrays and explain why in the reasoning field.
================ NOW CODE THE FOLLOWING NOTE ================"""

LLM_CODING_PROMPT_ICD10 = """
You are a dual-certified professional coder:
 • Board-certified ICD-10-CM and ICD-10-PCS medical coder
 • CPC® specializing in Current Procedural Terminology (CPT®)

Task: From the clinical note below, identify all billable diagnoses and procedures and assign the correct ICD-10-CM, ICD-10-PCS (if applicable), and CPT® codes.

ICD-10-CM / ICD-10-PCS RULES
• List the principal diagnosis first, followed by secondary diagnoses.
• For inpatient procedures, include ICD-10-PCS codes; for outpatient procedures, use CPT® only.
• ICD-10-CM codes must be 3–7 characters, alphanumeric, and use the highest level of specificity.
• Capture laterality (right, left, bilateral), encounter type (initial, subsequent, sequela), and combination codes where applicable.
• Ensure all codes are billable, valid, and properly sequenced.

CPT® RULES
• Highest-level E/M or critical-care code first → follow-up visits → procedures in chronological order.
• Use only 5-digit CPT® codes—no modifiers or HCPCS codes.
• Apply bundling/edit rules to avoid duplicate or inclusive services.

Workflow:
• Extract all diagnoses, symptom complexes, and procedures/therapies from the note.
• Identify the principal diagnosis, then secondary diagnoses and procedures in the correct sequence.
• Assign the most specific valid ICD-10-CM, ICD-10-PCS (if inpatient), and CPT® codes.
• Provide a concise explanation for each code.
• Double-check sequencing, specificity, and clinical consistency. Remove duplicates, non-billable items, and any modifiers or HCPCS codes.

Evidence requirements:
• For every code, include 1–3 evidence spans that are EXACT verbatim text copied from the note.
• CRITICAL: Evidence spans must match the note text EXACTLY—no quotes, no ellipses (...), no truncation markers, no added formatting.
• Copy the text exactly as written: if the note says "Hypertension", use "Hypertension" (not '"Hypertension"' or 'history of ... Hypertension').
• Prefer shorter, precise phrases (5-30 words) that appear verbatim in the note over longer passages.
• Newlines in the note should be preserved naturally—if the note has "Assessment:\n- Hypertension", copy it exactly including the newline.
• If you cannot find exact matching text in the note for a code, omit that evidence span rather than creating a paraphrase or approximation.
• Pair each evidence span with a brief explanation of why it supports that code.
• If unsure a code applies, omit it.

Return JSON only, matching this structure exactly:
{
  "reasoning": "overall reasoning about sequencing and code selection",
  "icd_codes": [
    {
      "code": "ICD-10-CM or ICD-10-PCS code",
      "description": "ICD-10-CM/PCS description",
      "explanation": "≤30 words explaining rationale",
      "evidence_spans": [
        {"text": "Assessment:\n- Hypertension", "explanation": "why this text supports the code"}
      ]
    }
  ],
  "cpt_codes": [
    {
      "code": "5-digit CPT code",
      "description": "CPT description",
      "explanation": "≤30 words explaining rationale",
      "evidence_spans": [
        {"text": "Assessment:\n- Hypertension", "explanation": "why this text supports the code"}
      ]
    }
  ]
}
If no codes exist, return empty arrays and explain why in the reasoning field.
================ NOW CODE THE FOLLOWING NOTE ================
"""


ALLOWED_EXTRA_KEYS = {
    "max_output_tokens",
    "reasoning_effort",
    "reasoning",
}

_OPENAI_CLIENT: Optional[OpenAI] = None


def _get_openai_client() -> OpenAI:
    global _OPENAI_CLIENT
    if _OPENAI_CLIENT is None:
        _OPENAI_CLIENT = OpenAI()
    return _OPENAI_CLIENT


def _build_messages(prompt: str, note: str) -> list[dict[str, Any]]:
    content = f"{prompt}\n```{note}\n```"
    return [
        {
            "role": "user",
            "content": [{"type": "input_text", "text": content}],
        }
    ]


def _invoke_openai(
    *,
    note: str,
    prompt: str,
    model_name: str,
    request_uuid: str,
    response_format: Dict[str, Any],
    options: Dict[str, Any],
) -> Any:
    client = _get_openai_client()
    payload: Dict[str, Any] = {
        "model": model_name,
        "input": _messages_to_responses_input(_build_messages(prompt, note)),

    }

    prepared_options = _prepare_responses_kwargs(options)
    payload.update(prepared_options)

    _maybe_add_minimal_reasoning(model_name, payload)

    extra_body = dict(payload.pop("extra_body", {}) or {})

    if response_format is not None:
        normalized_format = _normalize_response_format(response_format)
        text_cfg = payload.setdefault("text", {})
        if isinstance(text_cfg, dict):
            text_cfg["format"] = normalized_format
        else:
            payload["text"] = {"format": normalized_format}

    if "text" in payload and not payload["text"]:
        payload.pop("text")

    if extra_body:
        payload["extra_body"] = extra_body

    extras_log = {k: v for k, v in payload.items() if k not in {"model", "input"}}
    logger.info(
        "[llm_coding] Sending request %s to model=%s (extras=%s)",
        request_uuid,
        model_name,
        extras_log,
    )

    return client.responses.create(**payload)


def _extract_output_text(response_obj: Any) -> str:
    if response_obj is None:
        return ""
    text = getattr(response_obj, "output_text", None)
    if text:
        return str(text)
    pieces: List[str] = []
    for output in getattr(response_obj, "output", []) or []:
        for part in getattr(output, "content", []) or []:
            part_text = getattr(part, "text", None)
            if part_text:
                pieces.append(str(part_text))
    return "".join(pieces)


def _extract_parsed_output(response_obj: Any) -> Optional[Any]:
    if response_obj is None:
        return None
    for output in getattr(response_obj, "output", []) or []:
        for part in getattr(output, "content", []) or []:
            parsed = getattr(part, "parsed", None)
            if parsed is not None:
                if hasattr(parsed, "model_dump"):
                    return parsed.model_dump()
                return parsed
            if getattr(part, "type", None) == "output_text":
                maybe = _safe_json_loads(getattr(part, "text", None))
                if maybe is not None:
                    return maybe
    fallback = _safe_json_loads(getattr(response_obj, "output_text", None))
    if fallback is not None:
        return fallback
    return None


class LLMGenerationError(RuntimeError):
    """Raised when the LLM request fails or returns invalid payload."""


def _filter_extras(extras: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not extras:
        return {}
    filtered: Dict[str, Any] = {}
    for key, value in extras.items():
        if key in ALLOWED_EXTRA_KEYS and value is not None:
            filtered[key] = value
        else:
            logger.debug("Ignoring unsupported LLM option '%s'", key)
    return filtered


def _locate_span(
    note: str,
    snippet: str,
    used_ranges: List[Tuple[int, int]],
) -> Optional[Tuple[int, int]]:
    """Return the char-range for ``snippet`` within ``note`` avoiding reuse."""
    snippet = snippet.strip()
    if not snippet:
        return None

    search_start = 0
    note_lower = note.lower()
    snippet_lower = snippet.lower()
    snippet_len = len(snippet)

    while search_start <= len(note):
        idx = note.find(snippet, search_start)
        if idx == -1:
            idx = note_lower.find(snippet_lower, search_start)
            if idx == -1:
                return None
        end = idx + snippet_len
        candidate = (idx, end)
        overlaps = any(not (end <= start or idx >= stop) for start, stop in used_ranges)
        if overlaps:
            search_start = idx + 1
            continue
        return candidate
    return None


QUOTE_CHARS = "\"'“”‘’«»‹›„‟"
TRAILING_PUNCTUATION = ".,;:!?"


def _span_candidates(snippet: str) -> List[str]:
    cleaned = snippet.strip()
    if not cleaned:
        return []

    candidates: List[str] = []

    def add(value: str) -> None:
        value = value.strip()
        if value and value not in candidates:
            candidates.append(value)

    add(cleaned)

    without_quotes = cleaned.strip(QUOTE_CHARS)
    add(without_quotes)

    without_trailing = without_quotes.rstrip(TRAILING_PUNCTUATION)
    add(without_trailing)

    # Handle nested quotes like leading quote only
    if cleaned and cleaned[0] in QUOTE_CHARS:
        add(cleaned[1:])
    if cleaned and cleaned[-1] in QUOTE_CHARS:
        add(cleaned[:-1])

    return candidates


def _sanitize_spans(spans: Any, note: str) -> list[Dict[str, Any]]:
    if not isinstance(spans, list):
        return []
    cleaned: list[Dict[str, Any]] = []
    used_ranges: List[Tuple[int, int]] = []
    for span in spans:
        if not isinstance(span, dict):
            continue
        text = span.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        explanation = span.get("explanation")
        match = _locate_span(note, text, used_ranges)
        matched_text = text.strip()
        if match is None:
            for candidate in _span_candidates(text):
                match = _locate_span(note, candidate, used_ranges)
                if match is not None:
                    matched_text = note[match[0] : match[1]]
                    break
        if match is None:
            logger.warning("[llm_coding] Could not align evidence span: %r", text)
            start, end = -1, -1
        else:
            start, end = match
            used_ranges.append((start, end))
        cleaned.append(
            {
                "text": matched_text if start >= 0 else matched_text,
                "start": start,
                "end": end,
                "explanation": explanation.strip() if isinstance(explanation, str) else "",
            }
        )
    return cleaned


def predict_codes_with_llm(
    note: str,
    *,
    model_name: Optional[str] = None,
    extras: Optional[Dict[str, Any]] = None,
    icd_version: Optional[str] = "9",
) -> Dict[str, Any]:
    """Run the LLM coding prompt and return structured ICD/CPT predictions."""
    raw_note = note or ""
    if not raw_note.strip():
        raise ValueError("Clinical note must not be empty.")

    model = (model_name or DEFAULT_LLM_MODEL or "").strip()
    if not model:
        raise ValueError("No LLM model configured. Set LLM_CODING_MODEL or provide model_name.")

    payload_options = {"max_output_tokens": 5000}
    payload_options.update(_filter_extras(extras))

    request_uuid = uuid.uuid4().hex
    if icd_version == "9":
        prompt = LLM_CODING_PROMPT_ICD9
    elif icd_version == "10":
        prompt = LLM_CODING_PROMPT_ICD10
    else:
        raise ValueError("Invalid ICD version. Must be 9 or 10.")
    try:
        response = _invoke_openai(
            note=raw_note,
            prompt=prompt,
            model_name=model,
            request_uuid=request_uuid,
            response_format=LLM_RESPONSE_SCHEMA,
            options=payload_options,
        )
    except OpenAIError as exc:
        logger.error("[llm_coding] OpenAIError for model=%s: %s", model, exc, exc_info=True)
        raise LLMGenerationError(str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("[llm_coding] Unexpected error: %s", exc, exc_info=True)
        raise LLMGenerationError("Unexpected failure while calling the LLM.") from exc

    parsed = _extract_parsed_output(response)
    raw_content = _extract_output_text(response)
    if parsed is None:
        try:
            parsed = json.loads(raw_content)
        except json.JSONDecodeError as exc:
            logger.error("[llm_coding] Invalid JSON payload: %s", raw_content, exc_info=True)
            raise LLMGenerationError("LLM response was not valid JSON.") from exc

    if not isinstance(parsed, dict):
        logger.error("[llm_coding] Parsed payload had unexpected type: %s", type(parsed))
        raise LLMGenerationError("LLM response had unexpected structure.")

    icd_codes = parsed.get("icd_codes", [])
    cpt_codes = parsed.get("cpt_codes", [])
    reasoning = parsed.get("reasoning", "")

    normalized: Dict[str, Any] = {
        "model": model,
        "reasoning": reasoning if isinstance(reasoning, str) else "",
        "icd_codes": [],
        "cpt_codes": [],
    }

    for bucket_name, entries in (("icd_codes", icd_codes), ("cpt_codes", cpt_codes)):
        normalized_entries: list[Dict[str, Any]] = []
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                code = entry.get("code")
                description = entry.get("description")
                explanation = entry.get("explanation")
                spans = _sanitize_spans(entry.get("evidence_spans"), raw_note)
                if not isinstance(code, str) or not isinstance(description, str) or not isinstance(explanation, str):
                    continue
                normalized_entries.append(
                    {
                        "code": code.strip(),
                        "description": description.strip(),
                        "explanation": explanation.strip(),
                        "evidence_spans": spans,
                    }
                )
        normalized[bucket_name] = normalized_entries

    usage = getattr(response, "usage", None)
    if usage is not None:
        try:
            normalized["usage"] = usage.to_dict()  # type: ignore[attr-defined]
        except AttributeError:
            if hasattr(usage, "model_dump"):
                normalized["usage"] = usage.model_dump()
            elif isinstance(usage, dict):
                normalized["usage"] = usage

    normalized["raw_response"] = raw_content
    return normalized
def _safe_json_loads(payload: Optional[str]) -> Optional[Any]:
    if not payload or not isinstance(payload, str):
        return None
    try:
        return json.loads(payload)
    except Exception:
        return None


def _normalize_response_format(resp_fmt: Any) -> Any:
    if not isinstance(resp_fmt, dict):
        return resp_fmt
    if resp_fmt.get("type") != "json_schema":
        raise ValueError("response_format must have top-level 'type': 'json_schema'")

    js = dict(resp_fmt.get("json_schema") or {})
    if "schema" in js:
        schema = dict(js.get("schema") or {})
        name = js.get("name", "StructuredSchema")
    else:
        name = js.get("name", "StructuredSchema")
        schema = {k: v for k, v in js.items() if k != "name"}

    if not isinstance(schema, dict):
        raise ValueError("json_schema.schema must be a dict when provided")

    has_object_shape = (
        schema.get("type") == "object"
        or "properties" in schema
        or "required" in schema
    )
    if has_object_shape:
        schema.setdefault("type", "object")
        schema.setdefault("properties", {})
        schema.setdefault("additionalProperties", False)
        props = schema.get("properties")
        if isinstance(props, dict) and "required" not in schema:
            schema["required"] = list(props.keys())

    return {
        "type": "json_schema",
        "name": name,
        "schema": schema,
        "strict": True,
    }


def _messages_to_responses_input(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    converted: List[Dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        default_type = "input_text" if role != "assistant" else "output_text"

        normalized_parts: List[Dict[str, Any]] = []
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict):
                    part_copy = dict(part)
                    part_type = part_copy.get("type")
                    if part_type in (None, "text"):
                        part_copy["type"] = default_type
                    normalized_parts.append(part_copy)
                else:
                    normalized_parts.append({"type": default_type, "text": str(part)})
        else:
            normalized_parts.append({"type": default_type, "text": str(content)})

        converted.append({"role": role, "content": normalized_parts})
    return converted


def _prepare_responses_kwargs(options: Dict[str, Any]) -> Dict[str, Any]:
    prepared = dict(options)

    reasoning_effort = prepared.pop("reasoning_effort", None)
    if reasoning_effort and "reasoning" not in prepared:
        prepared["reasoning"] = {"effort": reasoning_effort}

    if "max_tokens" in prepared and "max_output_tokens" not in prepared:
        prepared["max_output_tokens"] = prepared.pop("max_tokens")

    max_completion = prepared.pop("max_completion_tokens", None)
    if max_completion is not None:
        text_cfg = prepared.setdefault("text", {})
        if isinstance(text_cfg, dict):
            text_cfg["max_output_tokens"] = max_completion
        else:
            prepared["text"] = {"max_output_tokens": max_completion}

    return prepared


def _maybe_add_minimal_reasoning(model_name: str, payload: Dict[str, Any]) -> None:
    if not model_name.startswith("gpt-5"):
        return
    if "reasoning" in payload or "reasoning_effort" in payload:
        return
    effort = (
        DEFAULT_GPT5_REASONING_EFFORT
        if DEFAULT_GPT5_REASONING_EFFORT in {"minimal", "low", "medium", "high"}
        else "minimal"
    )
    payload["reasoning"] = {"effort": effort}
