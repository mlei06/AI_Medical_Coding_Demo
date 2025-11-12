# Explainable Medical Coding Suite

An evaluation and inference toolkit for explainable medical code prediction, combining automated scoring pipelines with interactive inference services.

## Features

- **Medical Code Prediction**: Predict ICD-9, ICD-10, and CPT codes from clinical notes
- **Multiple Model Support**: 
  - Local PLM (Pre-trained Language Model) models with explainability methods
  - LLM-based prediction using OpenAI models (GPT-5, etc.)
- **Explainability**: Visualize evidence spans and explanations for predicted codes
- **Interactive UI**: Web-based interface for code prediction, review, and management
- **Evidence Highlighting**: See exactly which parts of the clinical note support each code
- **Code Management**: Save, review, and edit predicted codes with full audit trails

## Setup

### Prerequisites

- Python 3.11+
- pip
- wget (for downloading models)
- gdown (for downloading models from Google Drive)

### Installation

1. **Clone the repository** (if not already done)

2. **Create and activate a virtual environment** (recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env and add your OPENAI_API_KEY
   ```
   
   The `.env` file should contain:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   ```
   
   **Note**: The OpenAI API key is only required if you want to use LLM-based prediction. If you only use local PLM models, you can skip this step.

5. **Download models** (optional if you only want to use LLM):
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

   **Note**: Model downloads are optional. The system will work with LLM-based prediction without these models. However, PLM-based prediction requires the models to be downloaded.
6. **Download Testing data** (only required if you want to evaluate on mimic data with eval.py)
   gdown --id 1xqC10tyviXuU3iLVIjp7oH01RrimHW2- -O data/mimic_data/data.tar.gz
   tar -xvzf data/data.tar.gz -C data/mimic_data
   rm data/mimic_data/data.tar.gz

## Usage

### Running the API Server

Start the main API server:
```bash
python api.py
```

Or using uvicorn directly:
```bash
uvicorn api:app --host 0.0.0.0 --port 8084
```

The API will be available at `http://localhost:8084`
- API Documentation: http://localhost:8084/docs
- Health Check: http://localhost:8084/healthz

### Running the Demo UI

1. **Start the main API server** (see above) on `http://localhost:8084`

2. **Install UI dependencies** (if not already installed):
   ```bash
   pip install -r demo-ui/requirements.txt
   ```

3. **Start the UI server**:
   ```bash
   cd demo-ui
   uvicorn main:app --reload --port 8090
   ```

4. **Access the UI**: Visit http://localhost:8090

### Using Docker

Quick start:
```bash
# Create .env file
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Build and start services
docker-compose up -d --build

# Access the application
# Demo UI: http://localhost:8090
# API: http://localhost:8084
# API Docs: http://localhost:8084/docs
```

**Note**: Models are automatically downloaded during Docker build (first build takes 10-20 minutes). To skip model downloads for faster builds (LLM-only mode), set `BUILD_MODELS=false`:
```bash
BUILD_MODELS=false docker-compose build
docker-compose up -d
```

### Deploying Without Docker Compose

For deployment platforms that don't support docker-compose, you can deploy the services separately:

#### 1. Deploy API Service

```bash
# Build API image
docker build -t explainable-coding-api .

# Run API service
docker run -d \
  --name explainable-coding-api \
  -p 8084:8084 \
  --env-file .env \
  explainable-coding-api
```

**Important**: Make sure your API service is accessible and note its URL (e.g., `http://localhost:8084` for local, or your production URL)

#### 2. Deploy UI Service

```bash
# Build UI image
docker build -f demo-ui/Dockerfile -t explainable-coding-ui .
```

**Local Docker Desktop (host port mapping)**  
Use the host gateway to reach the API that you published on `localhost:8084`:

```bash
# Run UI service
docker run -d \
  --name explainable-coding-ui \
  -p 8090:8090 \
  -e UPSTREAM_API_BASE=http://host.docker.internal:8084 \
  explainable-coding-ui
```

**Local user-defined network / docker compose**  
If both containers share a Docker network (including the default network created by `docker compose`), point the UI directly at the API container:

```bash
docker network create explainable-coding

docker run -d \
  --name explainable-coding-api \
  --network explainable-coding \
  -p 8084:8084 \
  --env-file .env \
  explainable-coding-api

docker run -d \
  --name explainable-coding-ui \
  --network explainable-coding \
  -p 8090:8090 \
  -e UPSTREAM_API_BASE=http://explainable-coding-api:8084 \
  explainable-coding-ui
```

**Production deployment**  
When the API lives behind a public URL (or another internal endpoint), configure the UI with that URL:

```bash
docker run -d \
  --name explainable-coding-ui \
  -p 8090:8090 \
  -e UPSTREAM_API_BASE=https://your-api-service.com \
  explainable-coding-ui
```

**Critical**: You **must** set the `UPSTREAM_API_BASE` environment variable to your API service URL. The UI service needs this to proxy requests to the API.

**For Production Deployment:**
- Replace the sample `UPSTREAM_API_BASE` value with your actual API service URL (e.g., `https://your-api-service.com`)
- Set `UPSTREAM_API_BASE` as an environment variable in your platform's dashboard
- Use the full URL with protocol (https:// for production)


## API Endpoints

### Prediction Endpoints

- `POST /predict-explain` - Predict codes using PLM models with explainability
- `POST /predict-explain-llm` - Predict codes using LLM models

### Information Endpoints

- `GET /models` - List available models
- `GET /explain-methods` - List available explanation methods
- `GET /healthz` - Health check endpoint

See http://localhost:8084/docs for detailed API documentation.

## Project Structure

```
.
├── api.py                 # Main API server
├── demo-ui/              # Demo UI application
│   ├── main.py          # UI server
│   ├── frontend/        # Frontend assets
│   └── output/          # Saved outputs
├── utils/                # Utility modules
│   ├── PLM_explainer_service.py  # PLM-based prediction service
│   └── llm_explainer.py          # LLM-based prediction service
├── models/               # Model files (downloaded)
├── data/                 # Data files
│   ├── code_descriptions/  # Code description files
│   └── sample-notes/       # Sample clinical notes
└── requirements.txt      # Python dependencies
```

## Configuration

### Environment Variables

- `OPENAI_API_KEY` - OpenAI API key for LLM-based prediction (required for LLM features)
- `LLM_CODING_MODEL` - LLM model to use (default: "gpt-5")
- `GPT5_DEFAULT_REASONING_EFFORT` - Reasoning effort for GPT-5 models (default: "minimal")
- `UPSTREAM_API_BASE` - Upstream API base URL for UI (default: "http://localhost:8084")

### Model Configuration

Models are stored in the `models/` directory. The system automatically discovers available models:
- `roberta-base-pm-m3-voc-hf` - Base RoBERTa model (required for PLM prediction)
- Additional models can be added to the `models/` directory
