# API compatibility alias removal - August 2026

Docmost no longer serves the legacy read-like POST and command aliases listed
in earlier versions of `api-route-deprecation-matrix.md`. Supported clients must
use the canonical GET, resource, and `/actions/*` routes from the generated API
route inventory.

The two legacy `GET /api/files/*` routes remain temporarily available because
persisted page content may still reference them. New first-party content uses
`/api/attachments/files/*`.
