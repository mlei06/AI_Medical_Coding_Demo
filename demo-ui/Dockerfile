FROM python:3.11.5-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# UPSTREAM_API_BASE should be set via environment variable at runtime
# The application will use os.getenv("UPSTREAM_API_BASE", "http://localhost:8084")
# Set this when running the container or in your deployment platform:
#   - Docker Compose: UPSTREAM_API_BASE=http://api:8084
#   - Production: UPSTREAM_API_BASE=https://your-api-service.onrender.com
#   - Local: UPSTREAM_API_BASE=http://localhost:8084 (default)

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

# Expose port (can be overridden via PORT environment variable)
EXPOSE 8090

# Run the demo-ui application
# Use PORT environment variable if provided (for platforms like Render, Railway)
# Otherwise default to 8090
CMD sh -c "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8090}"

