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
from typing import Any, List, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
MODELS_ROOT = SCRIPT_DIR / "models"
DISPLAY_ROOT = Path("models")
BLACKLISTED_MODELS = {"roberta-base-pm-m3-voc-hf"}

DEFAULT_NOTE = (
"""
Chief Complaint: Chest pain and shortness of breath.

History of Present Illness:
The patient is a 62-year-old male with a history of hypertension and type 2 diabetes who presents with crushing substernal chest pain radiating to the left arm. Symptoms began 90 minutes prior to arrival. He reports associated diaphoresis and nausea.

ED Course:
EKG revealed ST elevations in leads II, III, and aVF consistent with an inferior STEMI. Troponin-I was elevated at 3.5 ng/mL. The patient was taken emergently to the cath lab and underwent successful PCI with insertion of a drug-eluting stent in the right coronary artery.

Assessment:
- ST elevation myocardial infarction (inferior wall)
- Hypertension
- Type 2 diabetes mellitus

Plan:
Admit to CCU for post-PCI monitoring.
Initiate dual antiplatelet therapy (aspirin + ticagrelor) and high-intensity statin.
Start beta blocker and ACE inhibitor once hemodynamically stable.

""" )


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


def call_api(
    *,
    note: str,
    use_llm: bool,
    model: Optional[str] = None,
    method: Optional[str] = None,
    confidence_threshold: Optional[float] = None,
    llm_model: Optional[str] = None,
    llm_options: Optional[dict] = None,
) -> Optional[dict]:
    """Invoke the FastAPI endpoint via curl and return the parsed JSON."""
    if use_llm:
        endpoint = "http://localhost:8084/predict-explain-llm"
        payload: dict[str, Any] = {"note": note}
        if llm_model:
            payload["model"] = llm_model
        if llm_options:
            payload["options"] = llm_options
    else:
        endpoint = "http://localhost:8084/predict-explain"
        payload = {
            "note": note,
            "model": model,
            "explain_method": method,
            "confidence_threshold": confidence_threshold,
        }

    serialized_payload = json.dumps(payload)

    cmd = [
        "curl",
        "-s",
        "-X",
        "POST",
        endpoint,
        "-H",
        "Content-Type: application/json",
        "-d",
        serialized_payload,
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

    reasoning = result.get("reasoning")
    if isinstance(reasoning, str) and reasoning.strip():
        print("\nLLM Reasoning:")
        print(reasoning.strip())

    icd_codes = result.get("icd_codes") or []
    if not icd_codes:
        print("\nNo ICD codes returned.")
    else:
        print("\nICD Codes:")
        is_llm_payload = any("evidence_spans" in entry for entry in icd_codes)

        for entry in icd_codes:
            code = entry.get("code", "<unknown>")
            description = entry.get("description") or ""
            probability = entry.get("probability")
            probability_text = (
                f"{probability:.4f}" if isinstance(probability, (float, int)) else "n/a"
            )

            print(f"\nCode: {code}")
            print(f"Description: {description}")
            if not is_llm_payload:
                print(f"Probability: {probability_text}")

            if is_llm_payload:
                explanation = entry.get("explanation") or ""
                if explanation:
                    print(f"Explanation: {explanation}")
                spans = entry.get("evidence_spans") or []
            else:
                explanation = entry.get("explanation") or {}
                spans = explanation.get("spans") or []
                tokens = explanation.get("tokens") or []
                if tokens:
                    print("Top tokens:")
                    for token_info in tokens:
                        rank = token_info.get("rank")
                        display_rank = (
                            f"{int(rank)}." if isinstance(rank, (int, float)) else "-"
                        )
                        token = token_info.get("token", "<unk>")
                        attribution = token_info.get("attribution")
                        attr_text = (
                            f"{attribution:.4f}"
                            if isinstance(attribution, (float, int))
                            else "n/a"
                        )
                        print(f"  {display_rank} {token} ({attr_text})")

            if spans:
                print("Evidence spans:")
                for span in spans:
                    start = span.get("start")
                    end = span.get("end")
                    text = span.get("text", "")
                    if isinstance(start, int) and isinstance(end, int) and start >= 0:
                        print(f"  [{start}-{end}] {text}")
                    else:
                        print(f"  {text}")

    cpt_codes = result.get("cpt_codes") or []
    if cpt_codes:
        print("\nCPT Codes:")
        for entry in cpt_codes:
            code = entry.get("code", "<unknown>")
            description = entry.get("description") or ""
            explanation = entry.get("explanation") or ""
            print(f"\nCode: {code}")
            print(f"Description: {description}")
            if explanation:
                print(f"Explanation: {explanation}")
            spans = entry.get("evidence_spans") or []
            if spans:
                print("Evidence spans:")
                for span in spans:
                    start = span.get("start")
                    end = span.get("end")
                    text = span.get("text", "")
                    if isinstance(start, int) and isinstance(end, int) and start >= 0:
                        print(f"  [{start}-{end}] {text}")
                    else:
                        print(f"  {text}")


def main() -> None:
    use_llm_input = input("Use OpenAI LLM endpoint? [y/N]: ").strip().lower()
    use_llm = use_llm_input == "y"

    note = prompt_note()

    if use_llm:
        llm_model = input("\nLLM model name (press Enter for server default): ").strip() or None
        llm_options: Optional[dict] = None
        options_input = input(
            "Optional LLM options JSON (e.g., {\"max_output_tokens\": 1200}). Leave blank to skip: "
        ).strip()
        if options_input:
            try:
                llm_options = json.loads(options_input)
            except json.JSONDecodeError:
                print("Invalid JSON for LLM options; ignoring.")
        print("\nSending request to LLM endpoint...")
        response = call_api(
            note=note,
            use_llm=True,
            llm_model=llm_model,
            llm_options=llm_options,
        )
    else:
        available_models = discover_models(MODELS_ROOT)
        selected_model = prompt_selection(available_models, "Model")
        selected_method = prompt_selection(EXPLAIN_METHODS, "Explainability Method")

        threshold_input = input("\nConfidence threshold (default 0.4): ").strip()
        try:
            confidence_threshold = float(threshold_input) if threshold_input else 0.4
        except ValueError:
            print("Invalid threshold. Using default 0.5.")
            confidence_threshold = 0.5

        print("\nSending request to local model endpoint...")
        response = call_api(
            note=note,
            use_llm=False,
            model=selected_model,
            method=selected_method,
            confidence_threshold=confidence_threshold,
        )

    if response is None:
        sys.exit(1)

    display_results(response)


if __name__ == "__main__":
    main()
