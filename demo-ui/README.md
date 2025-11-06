# Paste-Based UI Bridge

This sub-project exposes a lightweight FastAPI service that serves the demo UI
without importing the heavy model stack. It proxies API calls to the primary
`api.py` service so you can iterate on the interface without waiting for model
initialisation.

## UI Functionality

The demo UI provides two modes for medical coding:

**Predict Mode:**
- Predict ICD and CPT codes using LLM (OpenAI) or local models from uploaded/typed clinical notes
- View AI-suggested codes with explanations and evidence spans highlighted in the note
- Add codes manually via search lookup or directly from AI suggestions
- Add custom codes directly if not found in the lookup (with manual description entry)
- Finalize selected codes and save to output folders

**Review Mode:**
- Browse and search past output folders by admission ID
- Review previously saved notes and assigned codes
- Edit codes: add, remove, or modify existing codes
- Update admission IDs
- View highlighted evidence spans and explanations for existing codes

## Usage

1. Start the main API (the service that loads models) on `http://localhost:8084`
   or set `UPSTREAM_API_BASE` to match where it runs.
2. Install requirements for the bridge:

   ```bash
   pip install -r paste-based-ui/requirements.txt
   ```

3. Launch the UI bridge:

   ```bash
   uvicorn paste-based-ui.main:app --reload --port 8090
   ```

4. Visit `http://localhost:8090/` to load the demo interface.

All requests from the UI (models, explain methods, predictions, description.json)
are forwarded to the upstream service.
