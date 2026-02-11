FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create default storage directory
RUN mkdir -p /data/uploads

EXPOSE 4000

CMD ["node", "server.js"]
