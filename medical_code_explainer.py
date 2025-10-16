#!/usr/bin/env python3
"""
Medical Code Prediction and Explanation Script

This script loads a trained medical coding model and provides both:
1. ICD code predictions for input text
2. Token-level explanations showing which text justifies each prediction

Usage:
    python medical_code_explainer.py --text "Patient has diabetes and hypertension..."
    python medical_code_explainer.py --file clinical_note.txt --method laat --top_k 5
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
from transformers import AutoTokenizer
from omegaconf import OmegaConf

from explainable_medical_coding.utils.loaders import load_trained_model
from explainable_medical_coding.utils.analysis import predict, create_attention_mask
from explainable_medical_coding.utils.tokenizer import (
    TargetTokenizer, 
    get_tokens, 
    token_ids_to_spans
)
from explainable_medical_coding.config.factories import get_explainability_method


class MedicalCodeExplainer:
    """
    A comprehensive class for predicting medical codes and generating explanations.
    """
    
    def __init__(
        self,
        model_path: str = "models/unsupervised/gice8s68",
        device: Optional[str] = None
    ):
        """
        Initialize the explainer with a trained model.
        
        Args:
            model_path: Path to the trained model directory
            device: Device to run on (auto-detect if None)
        """
        self.model_path = Path(model_path)
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        
        print(f"Loading model from: {self.model_path}")
        print(f"Using device: {self.device}")
        
        # Load model components
        self._load_model_components()
        
        print(f"Model loaded successfully!")
        print(f"Vocabulary size: {len(self.target_tokenizer.target2id)} medical codes")
        print(f"Decision boundary: {self.decision_boundary:.4f}")
    
    def _load_model_components(self):
        """Load model, tokenizers, and configuration."""
        # Load model configuration
        config_path = self.model_path / "config.yaml"
        if not config_path.exists():
            raise FileNotFoundError(f"Config file not found: {config_path}")
        
        self.config = OmegaConf.load(config_path)
        
        # Load target tokenizer (medical codes)
        target_tokenizer_path = self.model_path / "target_tokenizer.json"
        if not target_tokenizer_path.exists():
            raise FileNotFoundError(f"Target tokenizer not found: {target_tokenizer_path}")
        
        self.target_tokenizer = TargetTokenizer(autoregressive=False)
        self.target_tokenizer.load(target_tokenizer_path)
        
        # Load text tokenizer
        text_tokenizer_path = self.config.model.configs.model_path
        self.text_tokenizer = AutoTokenizer.from_pretrained(text_tokenizer_path)
        
        # Load trained model
        self.model, self.decision_boundary = load_trained_model(
            experiment_path=self.model_path,
            config=self.config,
            pad_token_id=self.text_tokenizer.pad_token_id,
            device=self.device
        )
        
        # Get max length from config
        self.max_length = getattr(self.config.data, 'max_length', 6000)
    
    def predict_codes(
        self,
        text: str,
        decision_boundary: Optional[float] = None,
        top_k: Optional[int] = None,
        return_probabilities: bool = True
    ) -> Dict:
        """
        Predict medical codes for input text.
        
        Args:
            text: Input medical text
            decision_boundary: Threshold for binary classification
            top_k: If set, return top-k predictions instead of thresholded
            return_probabilities: Whether to include probabilities
        
        Returns:
            Dictionary with predictions and probabilities
        """
        if decision_boundary is None:
            decision_boundary = self.decision_boundary
        
        # Tokenize input text
        inputs = self.text_tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=self.max_length,
            padding=False
        )
        
        input_ids = inputs["input_ids"]
        
        # Get model predictions
        probabilities = predict(self.model, input_ids, self.device)
        probabilities = probabilities.squeeze()  # Remove batch dimension
        
        if top_k:
            # Get top-k predictions
            top_k_probs, top_k_indices = torch.topk(probabilities, min(top_k, len(probabilities)))
            predicted_indices = top_k_indices.tolist()
            predicted_probs = top_k_probs.tolist()
        else:
            # Use decision boundary
            binary_predictions = probabilities > decision_boundary
            predicted_indices = torch.where(binary_predictions)[0].tolist()
            predicted_probs = probabilities[predicted_indices].tolist()
        
        # Convert indices to medical codes
        predicted_codes = [
            self.target_tokenizer.id2target[idx] for idx in predicted_indices
        ]
        
        result = {
            "input_text": text,
            "predicted_codes": predicted_codes,
            "predicted_indices": predicted_indices,
            "num_predicted_codes": len(predicted_codes),
            "decision_boundary": decision_boundary
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
        return_spans: bool = True
    ) -> Dict:
        """
        Generate explanations for predicted medical codes.
        
        Args:
            text: Input medical text
            explanation_method: Method to use for explanations
            decision_boundary: Threshold for code prediction
            top_k_codes: Number of top codes to explain (None = use threshold)
            top_k_tokens: Number of top important tokens to return per code
            return_spans: Whether to convert tokens to character spans
        
        Returns:
            Dictionary with predictions and explanations
        """
        if decision_boundary is None:
            decision_boundary = self.decision_boundary
        
        # Get code predictions first
        predictions = self.predict_codes(
            text, 
            decision_boundary=decision_boundary, 
            top_k=top_k_codes,
            return_probabilities=True
        )
        
        if len(predictions["predicted_codes"]) == 0:
            return {
                **predictions,
                "explanations": {},
                "explanation_method": explanation_method,
                "message": "No codes predicted above threshold"
            }
        
        # Tokenize input
        inputs = self.text_tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=self.max_length,
            padding=False
        )
        
        input_ids = inputs["input_ids"].to(self.device)
        
        # Get explainer method
        try:
            explainer_factory = get_explainability_method(explanation_method)
            explainer = explainer_factory(
                model=self.model,
                baseline_token_id=self.text_tokenizer.mask_token_id,
                cls_token_id=self.text_tokenizer.cls_token_id,
                eos_token_id=self.text_tokenizer.eos_token_id,
            )
        except Exception as e:
            return {
                **predictions,
                "error": f"Failed to initialize explainer '{explanation_method}': {str(e)}",
                "available_methods": ["laat", "attention_rollout", "gradient_x_input", 
                                    "integrated_gradient", "deeplift", "grad_attention", 
                                    "atgrad_attention", "random"]
            }
        
        # Get target IDs for explanation
        target_indices = torch.tensor(predictions["predicted_indices"])
        
        # Generate explanations
        try:
            attributions = explainer(
                input_ids=input_ids,
                target_ids=target_indices,
                device=self.device,
            )  # Shape: [sequence_length, num_codes]
            
            attributions = attributions.cpu()
        except Exception as e:
            return {
                **predictions,
                "error": f"Failed to generate explanations: {str(e)}"
            }
        
        # Get tokens for interpretation
        tokens = get_tokens(input_ids.squeeze().cpu(), self.text_tokenizer)
        
        # Process explanations for each code
        explanations = {}
        
        for code_idx, (code, prob) in enumerate(zip(predictions["predicted_codes"], 
                                                   predictions["code_probabilities"].values())):
            
            code_attributions = attributions[:, code_idx]
            
            # Get top-k most important tokens
            top_k_values, top_k_indices = torch.topk(
                torch.abs(code_attributions), 
                min(top_k_tokens, len(code_attributions))
            )
            
            # Create token explanations
            token_explanations = []
            important_token_ids = []
            
            for rank, (token_idx, attribution_value) in enumerate(zip(top_k_indices, top_k_values)):
                token_idx_int = token_idx.item()
                if token_idx_int < len(tokens):
                    # Clean up RoBERTa tokenizer artifacts for display
                    raw_token = tokens[token_idx_int]
                    clean_token = raw_token.replace('Ġ', ' ').replace('Ċ', '\\n')
                    
                    token_explanations.append({
                        "rank": rank + 1,
                        "token": raw_token,  # Keep original for processing
                        "token_display": clean_token,  # Clean version for display
                        "token_index": token_idx_int,
                        "attribution": attribution_value.item(),
                        "attribution_normalized": attribution_value.item() / code_attributions.abs().sum().item()
                    })
                    important_token_ids.append(token_idx_int)
            
            explanation_data = {
                "code": code,
                "probability": prob,
                "explanation_method": explanation_method,
                "top_tokens": token_explanations,
                "all_attributions": code_attributions.tolist()
            }
            
            # Convert to character spans if requested
            if return_spans and important_token_ids:
                try:
                    # Convert token indices to character spans
                    important_tokens_tensor = torch.tensor(important_token_ids)
                    spans = token_ids_to_spans(
                        input_ids.squeeze().cpu(), 
                        important_tokens_tensor, 
                        self.text_tokenizer
                    )
                    
                    # Extract text for each span
                    span_texts = []
                    for span in spans:
                        start_char, end_char = span
                        span_text = text[start_char:end_char]
                        span_texts.append({
                            "text": span_text,
                            "start": start_char,
                            "end": end_char
                        })
                    
                    explanation_data["important_spans"] = span_texts
                except Exception as e:
                    explanation_data["span_error"] = f"Could not convert to spans: {str(e)}"
            
            explanations[code] = explanation_data
        
        return {
            **predictions,
            "explanations": explanations,
            "explanation_method": explanation_method,
            "tokens": tokens,
            "total_tokens": len(tokens)
        }


def format_output(results: Dict, verbose: bool = False) -> str:
    """Format results for display."""
    output = []
    
    # Header
    output.append("="*80)
    output.append("MEDICAL CODE PREDICTION AND EXPLANATION")
    output.append("="*80)
    
    # Input text (truncated)
    text = results["input_text"]
    if len(text) > 200:
        text = text[:200] + "..."
    output.append(f"Input Text: {text}")
    output.append("")
    
    # Error handling
    if "error" in results:
        output.append(f"❌ Error: {results['error']}")
        if "available_methods" in results:
            output.append(f"Available methods: {', '.join(results['available_methods'])}")
        return "\n".join(output)
    
    # Predictions summary
    output.append(f"📊 PREDICTIONS (threshold: {results['decision_boundary']:.4f})")
    output.append(f"Predicted {results['num_predicted_codes']} medical codes:")
    
    if "code_probabilities" in results:
        for code, prob in results["code_probabilities"].items():
            output.append(f"  • {code}: {prob:.4f}")
    else:
        for code in results["predicted_codes"]:
            output.append(f"  • {code}")
    
    # Explanations
    if "explanations" in results and results["explanations"]:
        output.append("")
        output.append(f"🔍 EXPLANATIONS (method: {results.get('explanation_method', 'unknown')})")
        
        for code, explanation in results["explanations"].items():
            output.append(f"\n--- {code} (probability: {explanation['probability']:.4f}) ---")
            
            # Top tokens
            output.append("Most important tokens:")
            for token_info in explanation["top_tokens"][:5]:  # Show top 5
                display_token = token_info.get('token_display', token_info['token'])
                output.append(f"  {token_info['rank']}. '{display_token}' "
                            f"(score: {token_info['attribution']:.4f})")
            
            # Important spans
            if "important_spans" in explanation:
                output.append("Important text spans:")
                for span in explanation["important_spans"]:
                    output.append(f"  • \"{span['text']}\" [chars {span['start']}-{span['end']}]")
            
            if verbose and "all_attributions" in explanation:
                output.append("All token attributions:")
                tokens = results.get("tokens", [])
                attributions = explanation["all_attributions"]
                for i, (token, attr) in enumerate(zip(tokens, attributions)):
                    if abs(attr) > 0.001:  # Only show non-zero attributions
                        output.append(f"  {i:3d}. {token:15s} {attr:8.4f}")
    
    return "\n".join(output)


def main():
    parser = argparse.ArgumentParser(
        description="Predict medical codes and generate explanations for clinical text"
    )
    
    # Input options
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--text", type=str, help="Input text to analyze")
    group.add_argument("--file", type=str, help="Path to text file containing medical text")
    
    # Model options
    parser.add_argument(
        "--model", 
        type=str, 
        default="models/unsupervised/gice8s68",
        help="Path to trained model directory"
    )
    parser.add_argument(
        "--device", 
        type=str, 
        choices=["cpu", "cuda"],
        help="Device to run on (auto-detect if not specified)"
    )
    
    # Prediction options
    parser.add_argument(
        "--decision-boundary", 
        type=float,
        help="Decision boundary for classification (uses model default if not specified)"
    )
    parser.add_argument(
        "--top-k-codes", 
        type=int,
        help="Return top-k most likely codes instead of thresholded predictions"
    )
    
    # Explanation options
    parser.add_argument(
        "--method", 
        type=str, 
        default="laat",
        choices=["laat", "attention_rollout", "gradient_x_input", "integrated_gradient", 
                "deeplift", "grad_attention", "atgrad_attention", "random"],
        help="Explanation method to use"
    )
    parser.add_argument(
        "--top-k-tokens", 
        type=int, 
        default=10,
        help="Number of top important tokens to show per code"
    )
    parser.add_argument(
        "--no-spans", 
        action="store_true",
        help="Don't convert tokens to character spans"
    )
    
    # Output options
    parser.add_argument(
        "--output", 
        type=str,
        help="Save results to JSON file"
    )
    parser.add_argument(
        "--verbose", 
        action="store_true",
        help="Show detailed token attributions"
    )
    
    args = parser.parse_args()
    
    # Load input text
    if args.file:
        try:
            with open(args.file, 'r', encoding='utf-8') as f:
                text = f.read().strip()
        except Exception as e:
            print(f"Error reading file {args.file}: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        text = args.text
    
    if not text:
        print("Error: Empty input text", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Initialize explainer
        explainer = MedicalCodeExplainer(args.model, args.device)
        
        # Generate predictions and explanations
        results = explainer.explain_predictions(
            text=text,
            explanation_method=args.method,
            decision_boundary=args.decision_boundary,
            top_k_codes=args.top_k_codes,
            top_k_tokens=args.top_k_tokens,
            return_spans=not args.no_spans
        )
        
        # Save to file if requested
        if args.output:
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            
            print(f"Results saved to: {args.output}")
        
        # Display results
        print(format_output(results, args.verbose))
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
