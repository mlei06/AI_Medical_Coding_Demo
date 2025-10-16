# Paste-Based UI Bridge

This sub-project exposes a lightweight FastAPI service that serves the demo UI
without importing the heavy model stack. It proxies API calls to the primary
`api.py` service so you can iterate on the interface without waiting for model
initialisation.

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
