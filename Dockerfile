# SidVicious_exe -- self-contained image for the Discord roadie.
# Build:  docker build -t sidvicious .
# Run:    docker run --rm --env-file stacks/.env sidvicious
FROM node:24-slim

WORKDIR /app

# Install runtime deps first so the layer caches across source-only changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application source.
COPY bot.mjs ./

# Logs go to stdout in container mode.
ENV DISCORD_LOG=/dev/stdout

# Drop to the stock non-root user shipped in the node image.
USER node

CMD ["node", "bot.mjs"]
