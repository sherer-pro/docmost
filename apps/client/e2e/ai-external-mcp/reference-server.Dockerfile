FROM node:22.23.1-slim

ARG EVERYTHING_VERSION=2026.7.4
ARG EVERYTHING_INTEGRITY=sha512-ydMW/M6rk9tK23b+U38trsNLHhd5eF+ntiv2Vr+RPMDhbiKY/IKrZU25ukvSXVPUBvy7TxTPWpeV4KcYcXg72w==

RUN test "$(npm view @modelcontextprotocol/server-everything@${EVERYTHING_VERSION} dist.integrity)" = "${EVERYTHING_INTEGRITY}" \
  && npm install --global --ignore-scripts --no-audit --no-fund "@modelcontextprotocol/server-everything@${EVERYTHING_VERSION}" \
  && npm cache clean --force

USER node
ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["mcp-server-everything", "streamableHttp"]
