#!/usr/bin/env python3
"""
Minimal CLI to exercise the LLM coding helper directly.

Example:
    OPENAI_API_KEY=sk-... poetry run python scripts/test_llm_predict.py --note-file sample.txt
"""

from __future__ import annotations
import dotenv
dotenv.load_dotenv()
import argparse
import sys
from pathlib import Path

from utils.llm_explainer import LLMGenerationError, predict_codes_with_llm


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test the LLM-based coding helper.")
    parser.add_argument(
        "--note-file",
        type=Path,
        help="Path to a text file containing the clinical note.",
    )
    parser.add_argument(
        "--note",
        type=str,
        help="Clinical note text provided directly via CLI.",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Override the OpenAI model (default determined by environment).",
    )
    return parser.parse_args()


def load_note(note_arg: str | None, note_file: Path | None) -> str:
    if note_arg:
        return note_arg
    if note_file:
        if not note_file.exists():
            raise FileNotFoundError(f"Note file not found: {note_file}")
        return note_file.read_text(encoding="utf-8")
    raise ValueError("Provide a clinical note via --note or --note-file.")


def main() -> None:
    args = parse_args()
    try:
        note = load_note(args.note, args.note_file)
        result = predict_codes_with_llm(
            note=note,
            model_name=args.model,
            extras=None,
        )
    except (ValueError, FileNotFoundError, LLMGenerationError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    print("Reasoning:\n", result.get("reasoning", ""))
    for bucket in ("icd_codes", "cpt_codes"):
        print(f"\n{bucket.upper()}:")
        entries = result.get(bucket) or []
        if not entries:
            print("  (none)")
            continue
        for entry in entries:
            print(f"  - Code: {entry.get('code')}")
            print(f"    Description: {entry.get('description')}")
            print(f"    Explanation: {entry.get('explanation')}")
            spans = entry.get("evidence_spans") or []
            if spans:
                print("    Evidence spans:")
                for span in spans:
                    start = span.get("start", -1)
                    end = span.get("end", -1)
                    text = span.get("text", "")
                    print(f"      [{start}-{end}] {text}")
                    if isinstance(start, int) and isinstance(end, int) and start >= 0 and end >= 0:
                        snippet = note[start:end]
                        print(f"        -> note[{start}:{end}] = {snippet}")


if __name__ == "__main__":
    main()
