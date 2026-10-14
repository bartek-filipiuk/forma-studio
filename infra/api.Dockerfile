FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxrender1 libxext6 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.12.23
WORKDIR /app/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --no-cache
COPY apps/api/ ./
COPY packages/ /app/packages/
RUN uv sync --locked --no-dev --no-cache
ENV PATH="/app/apps/api/.venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN useradd --uid 10001 --create-home forma && mkdir -p /app/data && chown -R forma:forma /app/data
USER forma
EXPOSE 8000
CMD ["uvicorn","forma.main:app","--host","0.0.0.0","--port","8000"]
