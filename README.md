# Explainable Medical Coding Suite

An evaluation and inference toolkit for explainable medical code prediction, combining automated scoring pipelines with interactive inference services.

## Features

- **Evaluation Harness**: `eval.py` guides LLM and PLM scoring with recall/precision metrics and optional dataset subsetting.
- **Explainable Inference**: FastAPI service exposes prediction and attribution APIs for ICD-9 and CPT codes.
- **Interactive Tooling**: Demo UI and cURL helper streamline manual review and experimentation.
- **Attribution Insights**: Token-level importance scores with accompanying confidence estimates.

## Setup

1. **Download models**  (optional if you only want to use LLM)
   ```bash
   wget https://dl.fbaipublicfiles.com/biolm/RoBERTa-base-PM-M3-Voc-hf.tar.gz -P models
   tar -xvzf models/RoBERTa-base-PM-M3-Voc-hf.tar.gz -C models
   rm models/RoBERTa-base-PM-M3-Voc-hf.tar.gz
   mv models/RoBERTa-base-PM-M3-Voc/RoBERTa-base-PM-M3-Voc-hf models/roberta-base-pm-m3-voc-hf
   rm -r models/RoBERTa-base-PM-M3-Voc

   gdown --id 1ilNUITkGlGYWj4a_ZOaWbkOx2io6aPAq -O models/temp.tar.gz
   tar -xvzf models/temp.tar.gz -C models
   rm models/temp.tar.gz
   ```

2. **Install dependencies (local workflow)**  
   ```bash
   python -m venv venv
   source venv/bin/activate          # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Environment variables**
   if you wish to use LLM for coding
   - copy .env.example to .env and provide openai api key

## Evaluation Workflow (`eval.py`)

Use `eval.py` to evaluate LLM and PLM on a chosen dataset and also create smaller datasets out of existing ones.

```bash
python eval.py
```

The script guides you through:

- **Optional subset creation** – create persistent CSV subsets to control evaluation size.
- **Dataset selection** – choose from CSVs discovered under `data/`.
- **Evaluation mode**
  - `LLM`: Calls `predict_codes_with_llm` (requires `OPENAI_API_KEY`).
  - `PLM`: Uses a locally stored PLM model; you will be prompted to pick a model directory and confidence threshold.
  - `Both`: Runs both evaluations sequentially.

Each run prints recall, precision, F1, and per-type recalls for diagnoses and procedures. Subsets created through the prompts are saved alongside the original data for reuse.

## Inference & Explanations & Coding Demo UI

### FastAPI Service (`api.py`)

Run the inference/explanation API either via Docker or locally.

**Docker**
```bash
docker build -t explainable-medical-coding .
docker run -d --name ml-service -p 8084:8084 explainable-medical-coding
```

**Local Development (Python 3.11.5)**
```bash
python api.py
```

The service is available at `http://localhost:8084`; visit `/docs` for interactive OpenAPI documentation.

### Interactive cURL helper (`curl_api_test.py`)

This script prompts you to choose a model directory and explainability method, gathers note text (or uses a built-in sample), and issues a `/predict-explain` request via `curl`. The response is formatted with codes, descriptions, and top tokens.

```bash
python curl_api_test.py
```

### Assisted medical coder demo UI (`demo-ui/`)

The demo UI is a lightweight FastAPI bridge plus static frontend that proxies requests to the upstream API so you can iterate quickly without reloading the heavy model stack.

1. **Start the upstream API** (Docker command above or `python api.py`)
2. **Launch the UI bridge**:
   ```bash
   uvicorn demo-ui.main:app --reload --port 8090
   ```
3. Visit `http://localhost:8090/` to use the interface. Drag-and-drop notes from `data/sample-notes/`, inspect AI-suggested codes with token highlights, curate a finalized list, and export results. Finalized outputs are written under `demo-ui/output/` in per-note folders.

## Project Structure Highlights
- `eval.py` - Evaluation script for LLM and PLM coding
- `api.py` – FastAPI application exposing `/predict-explain`, `/models`, and `/explain-methods`.
- `curl_api_test.py` – Interactive command-line tester for the API.
- `demo-ui/` – Self-contained proxy UI (FastAPI bridge + static frontend assets).
- `models/` – Expected location for downloaded model checkpoints.
