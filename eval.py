import pandas as pd

# from utils.explainer_service import EXPLAIN_METHODS, predict_explain as run_prediction
# from utils.llm_explainer import LLMGenerationError, predict_codes_with_llm
def get_data_subset(data_path: str = "data/mimic_data/mimiciii_full_icd9.csv", subset_size: int = 3):
    df = pd.read_csv(data_path)
    if len(df) < subset_size:
        return df
    else:
        return df.sample(subset_size)
def run_prediction_with_model(model = "models/forktrainedPLM_icd9", text: str = "", confidence_threshold: float = 0.4):
    result = run_prediction(text=text, model=model, confidence_threshold=confidence_threshold)
    icd_codes_result = result['icd_codes']
    icd_codes_array = []
    if icd_codes_result is not None:
        for icd_code in icd_codes_result:
            icd_codes_array.append(icd_code['code'])
    else:
        icd_codes_array = None

    cpt_codes = result['cpt_codes']
    cpt_codes_array = []
    if cpt_codes is not None:
        for cpt_code in cpt_codes:
            cpt_codes_array.append(cpt_code['code'])
    else:
        cpt_codes_array = None
    return icd_codes_array, cpt_codes_array

def run_prediction_with_llm(text: str = "", model_name: str = "gpt-5"):
    result = predict_codes_with_llm(note=text, model_name=model_name)
    icd_codes_result = result['icd_codes']
    icd_codes_array = []
    if icd_codes_result is not None:
        for icd_code in icd_codes_result:
            icd_codes_array.append(icd_code['code'])
    else:
        icd_codes_array = None

    cpt_codes = result['cpt_codes']
    cpt_codes_array = []
    if cpt_codes is not None:
        for cpt_code in cpt_codes:
            cpt_codes_array.append(cpt_code['code'])
    else:
        cpt_codes_array = None
    return icd_codes_array, cpt_codes_array







sample_text = """Chief Complaint: Chest pain and shortness of breath.

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
"""
# icd_codes, cpt_codes = run_prediction_with_model(text=sample_text)
# print(icd_codes)
# print(cpt_codes)

# icd_codes, cpt_codes = run_prediction_with_llm(text=sample_text)
# print(icd_codes)
# print(cpt_codes)
print(get_data_subset())