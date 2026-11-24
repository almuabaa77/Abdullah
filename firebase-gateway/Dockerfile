FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node server.mjs ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
