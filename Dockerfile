FROM node:22-alpine

WORKDIR /app

# Install deps first for better caching
COPY package*.json ./
RUN npm ci

# Copy sources and build
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm","run","start"]


