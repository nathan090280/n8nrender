FROM node:20-bookworm-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json /app/backend/
RUN npm ci --omit=dev --prefix /app/backend

COPY backend /app/backend
COPY trading /app/trading

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /app/trading/requirements.txt \
    && mkdir -p /data \
    && ln -s /data /app/trading/state \
    && ln -s /data /app/trading/data \
    && ln -s /data /app/state

WORKDIR /app/backend
CMD ["node", "src/server.js"]
