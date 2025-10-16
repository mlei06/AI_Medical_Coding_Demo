FROM python:3.11.5-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY . .

# Install poetry and run setup
RUN pip install poetry
RUN poetry config virtualenvs.in-project true
RUN poetry install


# Expose port
EXPOSE 8084

# Run the API
CMD ["poetry", "run", "uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8084"]