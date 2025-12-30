FROM node:24-alpine

WORKDIR /app

# Install deps first for better caching
COPY package*.json ./
COPY .npmrc ./
RUN npm ci --include=dev

# Copy sources and build
COPY . .
RUN npm run build

# Keep runtime image smaller / safer: remove devDependencies after build
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm","run","start"]


