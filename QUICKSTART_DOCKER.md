# Quick Start: Docker Compose Deployment

## Prerequisites

1. **Docker and Docker Compose installed**
2. **Model files** in `./models/` directory (will be included in image during build)
3. **Data files** in `./data/code_descriptions/` (icd9.json, icd10.json, cpt.json) (will be included in image)
4. **Optional**: `.env` file with `OPENAI_API_KEY` for LLM features

## Quick Start (3 Steps)

### 1. Prepare Environment (if needed)

```bash
# Create .env file for LLM features (optional)
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### 2. Start Services

```bash
docker-compose up -d
```

### 3. Access the Application

- **Demo UI**: http://localhost:8090
- **API**: http://localhost:8084
- **API Docs**: http://localhost:8084/docs

## Common Commands

```bash
# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f api
docker-compose logs -f ui

# Stop services
docker-compose down

# Restart services
docker-compose restart

# Rebuild and restart
docker-compose up -d --build

# Check service status
docker-compose ps
```

## Troubleshooting

### Services won't start

1. **Ensure models and data are present before building:**
   ```bash
   # Check models
   ls -la models/roberta-base-pm-m3-voc-hf
   
   # Check data files
   ls -la data/code_descriptions/
   ```

2. **Rebuild images if models/data are missing:**
   ```bash
   docker-compose build --no-cache
   ```

3. **Check logs:**
   ```bash
   docker-compose logs
   ```

### UI can't connect to API

1. **Wait for API to be healthy:**
   ```bash
   docker-compose ps
   # Wait until API shows as "healthy"
   ```

2. **Check API health:**
   ```bash
   curl http://localhost:8084/healthz
   ```

### Port already in use

If ports 8084 or 8090 are already in use, modify `docker-compose.yml`:

```yaml
services:
  api:
    ports:
      - "8085:8084"  # Change 8085 to your preferred port
  ui:
    ports:
      - "8091:8090"  # Change 8091 to your preferred port
```

### Models or data not found in container

If models or data are missing in the container, ensure they exist on the host and rebuild:

```bash
# Verify files exist
ls -la models/roberta-base-pm-m3-voc-hf
ls -la data/code_descriptions/

# Rebuild images
docker-compose build --no-cache
docker-compose up -d
```

## Next Steps

- See [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) for detailed deployment instructions
- See [README.md](./README.md) for project overview and features

