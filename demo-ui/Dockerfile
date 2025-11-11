FROM python:3.11.5-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UPSTREAM_API_BASE=http://api:8084

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies for demo-ui
COPY demo-ui/requirements.txt ./demo-ui/requirements.txt
RUN pip install --no-cache-dir -r demo-ui/requirements.txt

# Copy the demo-ui directory
COPY demo-ui ./demo-ui

# Copy data directory for code descriptions
# UI needs access to code description JSON files for search functionality
COPY data ./data

# Create output directory
RUN mkdir -p demo-ui/output

# Set working directory to demo-ui
WORKDIR /app/demo-ui

EXPOSE 8090

# Run the demo-ui application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]

