FROM python:3.11.5-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code, models, and data into image
# Models and data are included for self-contained deployment
COPY . .

EXPOSE 8084

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8084"]