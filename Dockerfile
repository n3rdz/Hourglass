FROM node:22-alpine
RUN apk add --no-cache git openssh-client \
 && git config --system --add safe.directory '*'
WORKDIR /app
ENV NODE_ENV=production PORT=8742 DATA_DIR=/app/data
EXPOSE 8742
# Der Code kommt NICHT ins Image, sondern wird als Git-Checkout eingebunden (siehe docker-compose.yml).
# So kann die App sich selbst per "git pull" aktualisieren.
CMD ["node", "server.js"]
