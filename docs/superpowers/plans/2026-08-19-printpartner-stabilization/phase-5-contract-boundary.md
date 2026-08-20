# Phase 5: make API contracts authoritative

[Back to the overview](overview.md)

## Goal

Give each API response one shared definition and reject invalid external data
at the browser boundary.

## Changes

- Inventory duplicate types in `api/engine.ts` and shared contracts.
- Pair the source naming client with server `GET` and `PUT` contracts and route
  tests.
- Implement the missing `PUT /sources/:id/naming` handler against that shared
  input contract. Persist valid Source-specific rules, return the shared output
  shape, and reject invalid folder and quantity rules without changing stored
  settings.
- Move one feature group at a time to the shared definition.
- Parse responses before returning them to feature code.
- Delete the duplicate definition after its callers migrate.
- Split the API file by capability only after ownership is clear.

Each change should cover one feature group and two or three files.

## Data structures

Each endpoint has a shared input schema, output schema, and inferred TypeScript
type. `engineFetch<T>()` receives the endpoint's success schema and shared error
schema. It parses successful and error JSON before returning or throwing; it
never casts response bodies to `T`. Malformed success bodies, malformed error
bodies, non-2xx responses, and transport failures all map to one discriminated
boundary error type while preserving safe status and request details.
The retained request-detail allowlist is method, route template, status,
request ID, and correlation ID. Never retain or expose raw headers, query
strings, request bodies, credentials, or provider payloads in this error.

## Verification

Static checks run contract tests, web tests, server tests, typecheck, and lint
for each migrated feature group.

Runtime checks proxy one malformed response for the migrated endpoint and
confirm that the UI shows a specific failure instead of consuming invalid
state. The Source naming route test saves valid Source-specific rules through
the existing naming client, reads them back through `GET`, and covers invalid
`PUT` input and a missing Source. Contract tests cover malformed success and
error payloads, a valid non-2xx error response, and a transport failure.
Redaction tests put secrets in headers, query parameters, bodies, and provider
payloads and prove none appear in the boundary error or logs.
