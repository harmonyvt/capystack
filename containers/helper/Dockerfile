# The optional helper container (off by default; see README.md). A place for work a Worker cannot do: native binaries
# (ffmpeg, yt-dlp), long CPU, node:http2, big files on disk. As cobalt's deploy/cloudflare/api/helper: one small Node
# server, guarded by an internal key only the Worker knows.
FROM node:22-slim

# Add what the helper needs here, e.g.:
# RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js ./
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.js"]
