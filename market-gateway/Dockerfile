FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --chown=node:node . .
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["npm","start"]
