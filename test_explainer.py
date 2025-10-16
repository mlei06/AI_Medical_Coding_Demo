#!/usr/bin/env python3
"""
Simple test script for the medical code explainer.
"""

import numpy as np
from medical_code_explainer import MedicalCodeExplainer
import json
def convert_to_json_serializable(obj):
    """Convert numpy types to native Python types for JSON serialization."""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_to_json_serializable(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_json_serializable(item) for item in obj]
    return obj

def predict_explain(text = None, method = "grad_attention", model = "models/unsupervised/gice8s68", confidence_threshold = 0.5):
    # Sample clinical text
    sample_text = """
    DISCHARGE SUMMARY
    
    HISTORY OF PRESENT ILLNESS:
    The patient is a 65-year-old male with a history of diabetes mellitus type 2 
    and hypertension who presented to the emergency department with chest pain 
    and shortness of breath. The patient reported onset of symptoms approximately 
    2 hours prior to arrival. EKG showed ST elevations in leads II, III, and aVF 
    consistent with inferior wall myocardial infarction.
    
    HOSPITAL COURSE:
    The patient was taken emergently to the cardiac catheterization lab where 
    he underwent primary percutaneous coronary intervention. A drug-eluting stent 
    was placed in the right coronary artery. Post-procedure, the patient was 
    stable and transferred to the cardiac care unit for monitoring.
    
    DISCHARGE DIAGNOSES:
    1. ST-elevation myocardial infarction, inferior wall
    2. Diabetes mellitus type 2, uncontrolled
    3. Essential hypertension
    """
    
    # Use provided text or fall back to sample text
    if text is None:
        text = sample_text
    
    try:
        # Initialize explainer
        print("Initializing medical code explainer...")
        explainer = MedicalCodeExplainer(model_path=model)
        
        # Get predictions and explanations
        print("\nGenerating predictions and explanations...")
        #explainers:
  #- random
  #- laat #this is what we call Attention in the paper
  #- attention_rollout
  #- deeplift
  #- gradient_x_input
  #- integrated_gradient
  # - occlusion ## slow
  # - kernelshap ## slow
  # - lime ## slow
  #- grad_attention #this is what we call AttInGrad in the paper
  #- atgrad_attention #this is what we call AttGrad in the paper
        print(f"Using explain method: {method}")
        results = explainer.explain_predictions(
            text=text,
            explanation_method=method,
            top_k_codes=10,  # Get top 10 predicted codes
            top_k_tokens=5,  # Show top 5 important tokens per code
            return_spans=True
        )
        
        # Display results
        print("\n" + "="*80)
        print("RESULTS")
        print("="*80)
        
        if "error" in results:
            print(f"Error: {results['error']}")
            return
        
        # Filter out codes below confidence threshold
        filtered_explanations = {
            code: explanation 
            for code, explanation in results.get("explanations", {}).items()
            if explanation.get("probability", 0.0) >= confidence_threshold
        }
        results["explanations"] = filtered_explanations
        results["num_predicted_codes"] = len(filtered_explanations)
        
        print(f"Predicted {results['num_predicted_codes']} medical codes (threshold: {confidence_threshold}):")
        print()

        for code, explanation in results["explanations"].items():
            print(f"Code: {code} (probability: {explanation['probability']:.4f})")
            print("Important tokens:")
            for token_info in explanation["top_tokens"]:
                display_token = token_info.get('token_display', token_info['token'])
                print(f"  {token_info['rank']}. '{display_token}' (score: {token_info['attribution']:.4f})")
            
            if "important_spans" in explanation:
                print("Important text spans:")
                for span in explanation["important_spans"]:
                    print(f"  • \"{span['text']}\"")
                    print(f"  • {span['start']}-{span['end']}")
                    print(f"  • {text[span['start']:span['end']]}")
            print()
        
        # Load description dictionary once
        try:
            with open("description.json", "r") as f:
                DESCRIPTION_DICT = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"Warning: Could not load description.json: {e}")
            DESCRIPTION_DICT = {}
        
        icd_codes = []
        for code, explanation in results.get("explanations", {}).items():
            # Extract spans
            spans = []
            if "important_spans" in explanation:
                for span in explanation["important_spans"]:
                    spans.append({
                        "text": span.get("text", ""),
                        "start": span.get("start", 0),
                        "end": span.get("end", 0)
                    })
            
            # Extract tokens
            tokens = []
            if "top_tokens" in explanation:
                for token_info in explanation["top_tokens"]:
                    tokens.append({
                        "token": token_info.get("token_display", token_info.get("token", "")),
                        "rank": token_info.get("rank", 0),
                        "attribution": token_info.get("attribution", 0.0)
                    })
            
            # Get description from dictionary, fallback to empty string if not found
            
            unformattedcode = code.replace(".", "")
            description = DESCRIPTION_DICT.get(unformattedcode, "")
            # Build the ICD code entry
            icd_codes.append({
                "code": code,
                "description": description,
                "probability": explanation.get("probability", 0.0),
                "explanation": {
                    "spans": spans,
                    "tokens": tokens
                }
            })
        
        formatted_results = {
            "cpt_codes": None,
            "icd_codes": icd_codes
        }
        
        # Convert numpy types to JSON-serializable types
        return convert_to_json_serializable(formatted_results)
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e), "traceback": traceback.format_exc()}

if __name__ == "__main__":
    predict_explain()
