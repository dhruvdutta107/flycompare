# ---- build stage: compile Tailwind CSS + fingerprint assets ----
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: production deps only ----
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/flycompare.db
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY --from=build /app/public ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
