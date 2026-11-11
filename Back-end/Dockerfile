FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv==0.11.6

COPY pyproject.toml uv.lock alembic.ini ./
COPY migrations ./migrations
COPY sql ./sql
COPY src ./src
COPY docker ./docker

RUN uv sync --locked --no-dev

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "kpi_dashboard.app:app", "--host", "0.0.0.0", "--port", "8000"]
