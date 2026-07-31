# Relay + one-click banking console (Node). Runs either process depending on
# the CMD/args passed by docker-compose (server.js = relay, scripts/demo-console.js = console).
FROM node:18-bookworm-slim

# trigger-fd-500.sh needs bash + curl + openssl
RUN apt-get update -qq && apt-get install -y --no-install-recommends bash curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev || npm install
COPY . .

# default: the banking console
CMD ["node", "scripts/demo-console.js"]
