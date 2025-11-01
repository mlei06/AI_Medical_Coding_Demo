import pandas as pd
import os
import dotenv
from utils.PLM_explainer_service import EXPLAIN_METHODS, predict_explain as run_prediction
from utils.llm_explainer import LLMGenerationError, predict_codes_with_llm
dotenv.load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
def create_data_subset(data_path: str = "", subset_size: int = 10):
    df = pd.read_csv(data_path)
    data_folder = data_path.split("/")[-2]
    data_name = data_path.split("/")[-1].split(".")[0]
    if len(df) > subset_size:
        df_subset = df.sample(subset_size)

        if os.path.exists(f"data/{data_folder}/{data_name}_subset{subset_size}.csv"):
            i = 0
            while os.path.exists(f"data/{data_folder}/{data_name}_subset{subset_size}_{i}.csv"):
                i += 1
            df_subset_name = f"data/{data_folder}/{data_name}_subset{subset_size}_{i}.csv"
        else:
            df_subset_name = f"data/{data_folder}/{data_name}_subset{subset_size}.csv"
        df_subset.to_csv(df_subset_name, index=False)
        return df_subset_name
    
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

    cpt_codes = result['cpt_codes']
    cpt_codes_array = []
    if cpt_codes is not None:
        for cpt_code in cpt_codes:
            cpt_codes_array.append(cpt_code['code'])
    return icd_codes_array, cpt_codes_array

def run_prediction_with_llm(text: str = "", model_name: str = "gpt-5", icd_version: str = "9"):
    result = predict_codes_with_llm(note=text, model_name=model_name, icd_version=icd_version)
    icd_codes_result = result['icd_codes']
    icd_codes_array = []
    if icd_codes_result is not None:
        for icd_code in icd_codes_result:
            icd_codes_array.append(icd_code['code'])

    cpt_codes = result['cpt_codes']
    cpt_codes_array = []
    if cpt_codes is not None:
        for cpt_code in cpt_codes:
            cpt_codes_array.append(cpt_code['code'])
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
def get_data_sets():
    data_sets = []
    for dir1 in os.listdir("data"):
        if dir1.endswith(".csv"):
            data_sets.append(f"data/{dir1}")
        elif os.path.isdir(f"data/{dir1}"):
            for dir2 in os.listdir(f"data/{dir1}"):
                if dir2.endswith(".csv"):
                    data_sets.append(f"data/{dir1}/{dir2}")
                elif os.path.isdir(f"data/{dir1}/{dir2}"):
                    for dir3 in os.listdir(f"data/{dir1}/{dir2}"):
                        if dir3.endswith(".csv"):
                            data_sets.append(f"data/{dir1}/{dir2}/{dir3}")
    return data_sets

def get_models():
    models = []
    for dir1 in os.listdir("models"):
        if os.path.isdir(f"models/{dir1}") and "roberta" not in dir1.lower():
            if os.path.exists(f"models/{dir1}/config.yaml"):
                models.append(f"models/{dir1}")
    return models
if __name__ == "__main__":
    def evaluate_llm():
        model_name = input("Enter model name(default is gpt-5): ")
        if model_name == "":
            model_name = "gpt-5"
        icd_version = input("Enter ICD version (9 or 10, default is 9): ")
        if icd_version == "":
            icd_version = "9"
        if icd_version not in ["9", "10"]:
            print(f"Invalid ICD version '{icd_version}'. Using default '9'.")
            icd_version = "9"
        TP = 0
        FP = 0
        FN = 0
        Proc_TP = 0
        Diag_TP = 0
        Proc_FN = 0
        Diag_FN = 0
        recall = 0
        precision = 0
        f1 = 0
        Diag_recall = 0
        Proc_recall = 0

        for i, row in df.iterrows():
            text = row['text']
            
            gold_diagnosis_codes = []
            if row['diagnosis_codes'] is not None and type(row['diagnosis_codes']) != float:
                for code in row['diagnosis_codes'].split("'"):
                    code.replace("[", "")
                    code.replace("]", "")
                    if code.strip() != "":
                        if code.replace(".", "").isalnum():
                            gold_diagnosis_codes.append(code.strip())
            
            gold_procedure_codes = []
            if row['procedure_codes'] is not None and type(row['procedure_codes']) != float:
                for code in row['procedure_codes'].split("'"):
                    code.replace("[", "")
                    code.replace("]", "")
                    if code.strip() != "":
                        if code.replace(".", "").isalnum():
                            gold_procedure_codes.append(code.strip())
            
            combined_gold_codes = gold_diagnosis_codes + gold_procedure_codes
            print(f"raw diagnosis codes: {row['diagnosis_codes']}")
            print(f"raw procedure codes: {row['procedure_codes']}")
            print(f"Combined gold codes: {combined_gold_codes}")
            predicted_icd_codes, predicted_cpt_codes = run_prediction_with_llm(text=text, model_name=model_name, icd_version=icd_version)
            print(f"Predicted ICD codes: {predicted_icd_codes}")
            print(f"Predicted CPT codes: {predicted_cpt_codes}")
            for gold_diag_code in gold_diagnosis_codes:
                if gold_diag_code in predicted_icd_codes:
                    Diag_TP += 1
                else:
                    Diag_FN += 1
            for gold_proc_code in gold_procedure_codes:
                if gold_proc_code in predicted_cpt_codes:
                    Proc_TP += 1
                else:
                    Proc_FN += 1
            for predicted_icd_code in predicted_icd_codes:
                if predicted_icd_code not in combined_gold_codes:
                    FP += 1
        TP = Diag_TP + Proc_TP
        FN = Diag_FN + Proc_FN
        if TP + FN == 0:
            recall = 0
        else:
            recall = TP / (TP + FN)
        if TP + FP == 0:
            precision = 0
        else:
            precision = TP / (TP + FP)
        if precision + recall == 0:
            f1 = 0
        else:
            f1 = 2 * (precision * recall) / (precision + recall)
        if Diag_TP + Diag_FN == 0:
            Diag_recall = 0
        else:
            Diag_recall = Diag_TP / (Diag_TP + Diag_FN)
        if Proc_TP + Proc_FN == 0:
            Proc_recall = 0
        else:
            Proc_recall = Proc_TP / (Proc_TP + Proc_FN)
        print(f"Recall: {recall}")
        print(f"Precision: {precision}")
        print(f"F1: {f1}")
        print(f"Diag Recall: {Diag_recall}")
        print(f"Proc Recall: {Proc_recall}")
    def evaluate_plm():
        models = get_models()
        if len(models) == 0:
            print("No models found")
            exit()
        for i, model in enumerate(models):
            print(f"{i}: {model}")
        model_index = input("Select a model: ")
        model_name = models[int(model_index)]
        confidence_threshold = input("Enter confidence threshold(default is 0.4): ")
        if confidence_threshold == "":
            confidence_threshold = 0.4
        else:
            confidence_threshold = float(confidence_threshold)
        TP = 0
        FP = 0
        FN = 0
        Proc_TP = 0
        Diag_TP = 0
        Proc_FN = 0
        Diag_FN = 0
        recall = 0
        precision = 0
        f1 = 0
        Diag_recall = 0
        Proc_recall = 0
        for i, row in df.iterrows():
            text = row['text']
            
            gold_diagnosis_codes = []
            if row['diagnosis_codes'] is not None and type(row['diagnosis_codes']) != float:
                for code in row['diagnosis_codes'].split("'"):
                    code.replace("[", "")
                    code.replace("]", "")
                    if code.strip() != "":
                        if code.replace(".", "").isalnum():
                            gold_diagnosis_codes.append(code.strip())
            
            gold_procedure_codes = []
            if row['procedure_codes'] is not None and type(row['procedure_codes']) != float:
                for code in row['procedure_codes'].split("'"):
                    code.replace("[", "")
                    code.replace("]", "")
                    if code.strip() != "":
                        if code.replace(".", "").isalnum():
                            gold_procedure_codes.append(code.strip())
            
            combined_gold_codes = gold_diagnosis_codes + gold_procedure_codes
            predicted_icd_codes, predicted_cpt_codes = run_prediction_with_model(text=text, model=model_name, confidence_threshold=confidence_threshold)
            for gold_diag_code in gold_diagnosis_codes:
                if gold_diag_code in predicted_icd_codes:
                    Diag_TP += 1
                else:
                    Diag_FN += 1
            for gold_proc_code in gold_procedure_codes:
                if gold_proc_code in predicted_cpt_codes:
                    Proc_TP += 1
                else:
                    Proc_FN += 1
            for predicted_icd_code in predicted_icd_codes:
                if predicted_icd_code not in combined_gold_codes:
                    FP += 1
        TP = Diag_TP + Proc_TP
        FN = Diag_FN + Proc_FN
        if TP + FN == 0:
            recall = 0
        else:
            recall = TP / (TP + FN)
        if TP + FP == 0:
            precision = 0
        else:
            precision = TP / (TP + FP)
        if precision + recall == 0:
            f1 = 0
        else:
            f1 = 2 * (precision * recall) / (precision + recall)
        if Diag_TP + Diag_FN == 0:
            Diag_recall = 0
        else:
            Diag_recall = Diag_TP / (Diag_TP + Diag_FN)
        if Proc_TP + Proc_FN == 0:
            Proc_recall = 0
        else:
            Proc_recall = Proc_TP / (Proc_TP + Proc_FN)
        print(f"Recall: {recall}")
        print(f"Precision: {precision}")
        print(f"F1: {f1}")
        print(f"Diag Recall: {Diag_recall}")
        print(f"Proc Recall: {Proc_recall}")
    create_data_subset_bool = input("Create Data Subset? (y/n): ")
    if create_data_subset_bool == "y":
        data_sets = get_data_sets()
        if len(data_sets) == 0:
            print("No data sets found")
            exit()
        #ask user to select a data set, enumerate the data sets and ask user to select a data set
        for i, data_set in enumerate(data_sets):
            print(f"{i}: {data_set}")
        data_set_index = input("Select a data set: ")
        data_set = data_sets[int(data_set_index)]
        len_df = len(pd.read_csv(data_set))
        subset_size = input(f"Enter subset size (max {len_df}): ")
        subset_size = int(subset_size)
        data_set_subset = create_data_subset(data_path=data_set, subset_size=subset_size)
        print(f"Subset created: {data_set_subset}")
    print("--------------------------------")
    data_sets = get_data_sets()
    if len(data_sets) == 0:
        print("No data sets found")
        exit()
    for i, data_set in enumerate(data_sets):
        print(f"{i}: {data_set}")
    data_set_index = input("Select a data set to evaluate on: ")
    data_set = data_sets[int(data_set_index)]
    print(f"Selected data set: {data_set}")
    print("--------------------------------")
    create_data_subset_bool = input("Use Data Subset(recommended if evaluating LLM since $$$)? (y/n): ")
    if create_data_subset_bool == "y":
        len_df = len(pd.read_csv(data_set))
        subset_size = input(f"Enter subset size (max {len_df}): ")
        subset_size = int(subset_size)
        df = get_data_subset(data_path=data_set, subset_size=subset_size)
    else:
        df = pd.read_csv(data_set)
    print("test printing first row of df:")
    print(df.iloc[0])

    Evaluation_options = ["LLM", "PLM", "Both"]

    evaluation_option = input(f"Select an evaluation option: {Evaluation_options}: ")
    if evaluation_option == "LLM" or evaluation_option == "llm":
        evaluate_llm()
    elif evaluation_option == "PLM":
        evaluate_plm()
    elif evaluation_option == "Both":
        evaluate_llm()
        evaluate_plm()
    
   
    
