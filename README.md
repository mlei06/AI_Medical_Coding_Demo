# Explainable Medical Coding Service

A FastAPI service for explainable medical code prediction using pre-trained language models with attribution analysis.

## Features

- **Medical Code Prediction**: Predict ICD-9 and CPT codes from clinical notes
- **Explainability**: Token-level attribution analysis showing which parts of the text influenced predictions
- **Confidence Scores**: Probability scores for each predicted code
- **REST API**: FastAPI-based service with automatic documentation

## Getting Started

1. **Download models**  
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

2. **Run the upstream API**  
   **Docker**
   ```bash
   docker build -t explainable-medical-coding .
   docker run -d --name ml-service -p 8084:8084 explainable-medical-coding
   ```

   **Local Development (Python 3.11.5)**
   ```bash
   python -m venv venv
   source venv/bin/activate          # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   uvicorn api:app --reload --port 8084
   ```

   The API will be available at `http://localhost:8084`. Visit `/docs` for interactive OpenAPI documentation.

## Helper Tools

### Interactive cURL helper (`curl_api_test.py`)

This script prompts you to choose a model directory and explainability method, gathers note text (or uses a built-in sample), and issues a `/predict-explain` request via `curl`. The response is formatted with codes, descriptions, and top tokens.

```bash
python curl_api_test.py
```

### Assisted medical coder demo UI (`demo-ui/`)

The demo UI is a lightweight FastAPI bridge plus static frontend that proxies requests to the upstream API so you can iterate quickly without reloading the heavy model stack.

1. **Start the upstream API** (Docker command above or `uvicorn api:app --reload --port 8084`)
2. **Install UI bridge dependencies** (one-time):
   ```bash
   pip install -r demo-ui/requirements.txt
   ```
3. **Launch the UI bridge**:
   ```bash
   uvicorn demo-ui.main:app --reload --port 8090
   ```
4. Visit `http://localhost:8090/` to use the interface. Drag-and-drop notes from `data/sample-notes/`, inspect AI-suggested codes with token highlights, curate a finalized list, and export results. Finalized outputs are written under `demo-ui/output/` in per-note folders.

## Project Structure Highlights

- `api.py` – FastAPI application exposing `/predict-explain`, `/models`, and `/explain-methods`.
- `curl_api_test.py` – Interactive command-line tester for the API.
- `demo-ui/` – Self-contained proxy UI (FastAPI bridge + static frontend assets).
- `models/` – Expected location for downloaded model checkpoints.
