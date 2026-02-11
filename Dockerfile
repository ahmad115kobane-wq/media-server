FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create default storage directory
RUN mkdir -p /data/uploads

CMD ["node", "server.js"]
