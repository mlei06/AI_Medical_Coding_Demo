FROM python:3.11.5-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies including wget for model downloads
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Create models directory
RUN mkdir -p models

# Download models (optional - can be skipped if only using LLM)
# Models are large (~1-5GB), so this step can take several minutes
# Set BUILD_MODELS=false to skip model downloads
ARG BUILD_MODELS=true
RUN if [ "$BUILD_MODELS" = "true" ]; then \
    echo "Downloading models..." && \
    wget -q https://dl.fbaipublicfiles.com/biolm/RoBERTa-base-PM-M3-Voc-hf.tar.gz -P models && \
    tar -xzf models/RoBERTa-base-PM-M3-Voc-hf.tar.gz -C models && \
    rm models/RoBERTa-base-PM-M3-Voc-hf.tar.gz && \
    mv models/RoBERTa-base-PM-M3-Voc/RoBERTa-base-PM-M3-Voc-hf models/roberta-base-pm-m3-voc-hf && \
    rm -rf models/RoBERTa-base-PM-M3-Voc && \
    gdown --id 1HCpT8BujdYFcvoS5jZLhEKhPv3f7VHEE -O models/temp.tar.gz && \
    tar -xzf models/temp.tar.gz -C models && \
    rm models/temp.tar.gz && \
    echo "Models downloaded successfully"; \
    else \
    echo "Skipping model downloads (BUILD_MODELS=false). Only LLM features will be available."; \
    fi

# Copy application code and data into image
# Note: Models are downloaded above, not copied from local filesystem
COPY . .

# Expose port (can be overridden via PORT environment variable)
EXPOSE 8084

# Use PORT environment variable if provided (for platforms like Render, Railway)
# Otherwise default to 8084
CMD sh -c "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8084}"
