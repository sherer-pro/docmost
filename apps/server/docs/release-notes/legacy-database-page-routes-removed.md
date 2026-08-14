# Release note: legacy database and page routes removed

The client no longer registers the internal legacy routes
`/s/:spaceSlug/databases/:databaseId` and `/p/:pageSlug`.

Canonical routes are now the only supported internal navigation formats:

- database pages: `/s/:spaceSlug/db/:databaseSlug`;
- ordinary pages: `/s/:spaceSlug/p/:pageSlug`.

Requests to either removed route use the standard application not-found flow.
Public share routes under `/share/...` are unchanged.

Database and page URL generation remains centralized in the client URL helpers.
Repository contract tests reject reintroducing either removed route and require
both canonical route registrations to remain present.
