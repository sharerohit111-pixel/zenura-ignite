FROM node:22-slim
WORKDIR /app
COPY market-gateway/package*.json ./market-gateway/
WORKDIR /app/market-gateway
RUN npm install --omit=dev --no-audit --no-fund
COPY market-gateway/ ./
COPY functions/lib/ /app/functions/lib/
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node","supabase-server.js"]
