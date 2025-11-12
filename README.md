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

For a containerized setup, see [QUICKSTART_DOCKER.md](./QUICKSTART_DOCKER.md) for detailed instructions.

Quick start:
```bash
# Create .env file
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Start services
docker-compose up -d

# Access the application
# Demo UI: http://localhost:8090
# API: http://localhost:8084
# API Docs: http://localhost:8084/docs
```

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

## Troubleshooting

### Models not found

If you see errors about models not being found:
1. Ensure models are downloaded (see Setup step 5)
2. Check that `models/roberta-base-pm-m3-voc-hf` exists
3. Verify model files are not corrupted

### OpenAI API errors

If LLM prediction fails:
1. Check that `OPENAI_API_KEY` is set in `.env`
2. Verify the API key is valid and has sufficient credits
3. Check network connectivity

### UI can't connect to API

1. Ensure the API server is running on `http://localhost:8084`
2. Check the `UPSTREAM_API_BASE` environment variable in the UI server
3. Verify both services are accessible

## License

[Add your license information here]

## Contributing

[Add contributing guidelines here]

## References

- RoBERTa-base-PM-M3-Voc model: [BioLM](https://github.com/facebookresearch/biolm)

