FROM node:22-alpine

WORKDIR /app

# Debug marker: if the platform uses THIS Dockerfile from the repo, this line will appear in build logs.
RUN echo "USING_REPO_DOCKERFILE"

# Install deps first for better caching
COPY package*.json ./
COPY .npmrc ./
RUN npm ci

# Copy sources and build
COPY . .
RUN npm run build

# Keep runtime image smaller / safer: remove devDependencies after build
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm","run","start"]


