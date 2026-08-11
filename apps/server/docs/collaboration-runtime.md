# Collaboration runtime operations

Docmost requires a dedicated collaboration process in development and
production. The API process never hosts the `/collab` WebSocket endpoint or a
Hocuspocus document.

## Configuration

- `COLLAB_URL` is the browser-visible HTTP(S) origin. The client converts it to
  `ws:` or `wss:` and appends `/collab`.
- `COLLAB_INTERNAL_URL` is the API-to-collab HTTP origin. In Compose it is
  `http://collab:3001`; it does not need to be browser-reachable.
- `COLLAB_INTERNAL_SECRET` is an independent credential of at least 32
  characters. Container deployments should use
  `COLLAB_INTERNAL_SECRET_FILE` and grant the secret to both application roles.

Never log the internal URL query values, the secret, or command payloads.

## Startup and health

`pnpm dev` starts frontend, API, and collab. Individual roles remain available
through `pnpm server:dev` and `pnpm collab:dev`. API liveness is intentionally
independent of collab liveness; operations that need a live document return
`503` while collab is unavailable.

Check both roles before accepting a deployment:

```bash
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3001/api/health
```

The API `/collab` path must not return WebSocket status `101`. The collab
process must reject an unauthenticated
`POST /api/internal/collaboration/commands` with `401`.

## Rollout and rollback

1. Provision `COLLAB_INTERNAL_URL` and `COLLAB_INTERNAL_SECRET` for both roles.
2. Deploy the new collab process first and verify its health and internal auth
   negative check.
3. Deploy the API and verify page editing, template mutation, and AI live-page
   reads/writes.
4. Remove any reverse-proxy route that sends `/collab` to the API origin.

Do not run a new API against an old collab image that lacks the internal command
endpoint. For rollback, roll back the API first, then collab. Database and Yjs
formats are unchanged, so no data migration is required.
