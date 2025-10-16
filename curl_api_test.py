#!/usr/bin/env python3
"""
Interactive helper to hit the explainable medical coding API via curl.

The script:
1. Discovers local model directories and prompts the user to select one.
2. Prompts for an explainability method from the supported list.
3. Accepts a clinical note (or uses a default sample).
4. Calls the running FastAPI service with curl.
5. Formats the response to highlight code, description, and top tokens.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
MODELS_ROOT = SCRIPT_DIR / "models"
DISPLAY_ROOT = Path("models")
BLACKLISTED_MODELS = {"roberta-base-pm-m3-voc-hf"}

DEFAULT_NOTE = (
    "DISCHARGE SUMMARY\n\n"
    "HISTORY OF PRESENT ILLNESS:\n"
    "The patient is a 65-year-old male with a history of diabetes mellitus type 2 "
    "and hypertension who presented to the emergency department with chest pain "
    "and shortness of breath. The patient reported onset of symptoms approximately "
    "2 hours prior to arrival. EKG showed ST elevations in leads II, III, and aVF "
    "consistent with inferior wall myocardial infarction.\n\n"
    "HOSPITAL COURSE:\n"
    "The patient was taken emergently to the cardiac catheterization lab where "
    "he underwent primary percutaneous coronary intervention. A drug-eluting stent "
    "was placed in the right coronary artery. Post-procedure, the patient was "
    "stable and transferred to the cardiac care unit for monitoring.\n\n"
    "DISCHARGE DIAGNOSES:\n"
    "1. ST-elevation myocardial infarction, inferior wall\n"
    "2. Diabetes mellitus type 2, uncontrolled\n"
    "3. Essential hypertension\n"
)

EXPLAIN_METHODS = [
    "grad_attention",
    "atgrad_attention",
    "laat",
    "attention_rollout",
    "deeplift",
    "gradient_x_input",
    "integrated_gradient",
    "occlusion",
    "kernelshap",
    "lime",
    "random",
]


def discover_models(root: Path) -> List[str]:
    """Return a sorted list of model directories that contain files."""
    if not root.exists():
        return []

    discovered = set()
    for path in root.rglob("*"):
        if not path.is_dir():
            continue
        if path == root:
            continue
        if path.name in BLACKLISTED_MODELS:
            continue
        try:
            contains_file = any(child.is_file() for child in path.iterdir())
        except PermissionError:
            contains_file = False
        if contains_file:
            rel_path = path.relative_to(root)
            display_path = (DISPLAY_ROOT / rel_path).as_posix()
            discovered.add(display_path)
    return sorted(discovered)


def prompt_selection(options: List[str], label: str) -> str:
    """Prompt the user to select from enumerated options or enter a custom value."""
    if not options:
        print(f"No predefined {label.lower()} options found.")
        return input(f"Enter {label.lower()} manually: ").strip()

    print(f"\nAvailable {label}:")
    for idx, option in enumerate(options, start=1):
        print(f"  {idx}. {option}")

    while True:
        choice = input(f"Select {label} by number or enter a custom value: ").strip()
        if not choice:
            print("Please make a selection.")
            continue

        if choice.isdigit():
            selected_index = int(choice)
            if 1 <= selected_index <= len(options):
                return options[selected_index - 1]
            print("Selection out of range.")
            continue

        return choice


def prompt_note() -> str:
    """Collect a clinical note from stdin or fall back to a default sample."""
    print(
        "\nEnter the clinical note (finish with a single '.' on its own line). "
        "Press Enter immediately to use the default sample."
    )
    lines = []
    try:
        while True:
            line = input()
            if not lines and not line.strip():
                return DEFAULT_NOTE
            if line.strip() == ".":
                break
            lines.append(line)
    except EOFError:
        pass

    note = "\n".join(lines).strip()
    return note or DEFAULT_NOTE


def call_api(note: str, model: str, method: str, confidence_threshold: float) -> Optional[dict]:
    """Invoke the FastAPI endpoint via curl and return the parsed JSON."""
    payload = json.dumps(
        {
            "note": note,
            "model": model,
            "explain_method": method,
            "confidence_threshold": confidence_threshold,
        }
    )

    cmd = [
        "curl",
        "-s",
        "-X",
        "POST",
        "http://localhost:8084/predict-explain",
        "-H",
        "Content-Type: application/json",
        "-d",
        payload,
    ]

    try:
        completed = subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        print("curl failed:")
        if exc.stdout:
            print("STDOUT:", exc.stdout)
        if exc.stderr:
            print("STDERR:", exc.stderr)
        return None

    raw_output = completed.stdout.strip()
    if not raw_output:
        print("API returned an empty response.")
        return None

    try:
        return json.loads(raw_output)
    except json.JSONDecodeError as error:
        print("Failed to parse API response as JSON.")
        print(raw_output)
        print(f"Error: {error}")
        return None


def display_results(result: dict) -> None:
    """Print codes, descriptions, and top tokens."""
    if "error" in result:
        print(f"\nAPI error: {result['error']}")
        return

    icd_codes = result.get("icd_codes") or []
    if not icd_codes:
        print("\nNo ICD codes returned.")
        return

    print("\nICD Codes:")
    for entry in icd_codes:
        code = entry.get("code", "<unknown>")
        description = entry.get("description") or ""
        probability = entry.get("probability")
        probability_text = f"{probability:.4f}" if isinstance(probability, (float, int)) else "n/a"
        print(f"\nCode: {code}")
        print(f"Description: {description}")
        print(f"Probability: {probability_text}")

        tokens = entry.get("explanation", {}).get("tokens") or []
        if not tokens:
            print("Top tokens: (none)")
            continue

        print("Top tokens:")
        for token_info in tokens:
            rank = token_info.get("rank")
            display_rank = f"{int(rank)}." if isinstance(rank, (int, float)) else "-"
            token = token_info.get("token", "<unk>")
            attribution = token_info.get("attribution")
            attr_text = f"{attribution:.4f}" if isinstance(attribution, (float, int)) else "n/a"
            print(f"  {display_rank} {token} ({attr_text})")


def main() -> None:
    available_models = discover_models(MODELS_ROOT)
    selected_model = prompt_selection(available_models, "Model")

    selected_method = prompt_selection(EXPLAIN_METHODS, "Explainability Method")

    note = prompt_note()

    threshold_input = input("\nConfidence threshold (default 0.4): ").strip()
    try:
        confidence_threshold = float(threshold_input) if threshold_input else 0.4
    except ValueError:
        print("Invalid threshold. Using default 0.5.")
        confidence_threshold = 0.5

    print("\nSending request...")
    response = call_api(
        note=note,
        model=selected_model,
        method=selected_method,
        confidence_threshold=confidence_threshold,
    )
    if response is None:
        sys.exit(1)

    display_results(response)


if __name__ == "__main__":
    main()
