# Source naming contract architecture

## Decision

`@print-partner/contracts` owns the serialized STL naming profile and the
runtime contract for `GET /sources/:id/naming` and
`PUT /sources/:id/naming`.

The contracts package exports Zod 4 schemas, types inferred from those schemas,
safe parser functions, and the default serialized profile. The server and the
browser call the same parsers. The domain package keeps compiled naming
behavior and delegates serialized profile validation to the contracts package.

This unit does not change `engineFetch()`. The Source naming functions use an
endpoint-specific parsed request helper. The next Phase 5 unit can move that
proven pattern into the shared browser transport.

## Data shapes

The write input is a discriminated union:

```ts
type SourceNamingPutInput =
  | { readonly use_defaults: true }
  | {
      readonly use_defaults: false;
      readonly override: StlNamingProfile;
    };
```

New custom writes contain a complete profile. A defaults write has no unused
`override` field.

The response keeps the stored override and the effective profile separate:

```ts
type SourceNamingResponse = {
  readonly use_defaults: boolean;
  readonly override: StlNamingProfileOverride;
  readonly effective: StlNamingProfile;
  readonly effective_digest: string;
};
```

`StlNamingProfileOverride` is a deep sparse shape. Installed Sources can inherit
global fields through sparse role patches and sparse nested `quantity` and
`slug` values. A role patch is identified by its canonical role ID and may
override only its label, markers, or both. The read contract preserves that
meaning. It never presents the resolved effective profile as if the Source
stored a complete override.

Endpoint errors use stable codes:

- `invalid_source_naming`, status `400`;
- `source_not_found`, status `404`;
- `source_naming_conflict`, status `409`; and
- `invalid_source_naming_state`, status `500`.

Parsers accept `unknown`. Parser errors retain a safe field path and message.
They do not retain the rejected value.

## Validation

The shared profile schema enforces these rules:

- `roles` is a non-empty list with unique canonical IDs and a `primary` role.
- Labels are not blank and markers are strings.
- `quantity.regex` is not blank, compiles, and contains one capture group.
- `quantity.default` is a finite integer of at least one.
- Each folder rule has a non-blank path, a canonical role, and an optional
  `functional` or `cosmetic` class.
- Slug flags are booleans.
- `export_role_order` contains each canonical role exactly once.
- Strict request objects reject misspelled or unused fields.

The parser rejects invalid values. It does not coerce strings, floor fractions,
clamp numbers, or repair stored metadata.

## Ownership

| Module | Ownership |
|---|---|
| `web/packages/contracts/src/source-naming.ts` | Serialized schemas, inferred types, defaults, endpoint errors, status mapping, and parsers. |
| `web/packages/domain/src/stl-naming.ts` | Compiled expressions, profile merging, legacy override interpretation, classification, and `NamingProfile`. |
| `web/apps/server/src/routes/settings.ts` | HTTP parameter parsing, request parsing, response parsing, and status mapping. |
| `web/apps/server/src/db/repository.ts` | Atomic metadata merge and typed read or save results. |
| `web/apps/web/src/api/engine.ts` | Source-specific HTTP mechanics and parsed success or error results. |
| `SourceDetailSheet.tsx` | Form state and user-facing error handling. |

The repository returns exhaustive result variants for found, saved, missing,
and write-conflict states. The route does not compare exception messages.

## Boundary flow

For `PUT`, the server parses the body before it calls the repository. A parse
failure returns `400` and performs no database read or write. The repository
builds valid next metadata before the existing optimistic conditional update.

For `GET` and successful `PUT`, the route parses the repository result before
sending it. Invalid stored state returns a safe `500` without rewriting the
Source.

The browser reads response JSON as `unknown`. It parses successful responses
and coded endpoint errors before feature code receives them. Browser failures
retain only the method, the route template, and a safe status. They do not
retain the Source ID, headers, body, raw response, or provider data.

## Migration

Add:

- `web/packages/contracts/src/source-naming.ts`;
- `web/packages/contracts/src/source-naming.test.ts`; and
- `web/apps/web/src/api/engine.source-naming.test.ts`.

Migrate:

- domain naming types, defaults, and serialized validation;
- repository Source naming result types;
- the two Source naming routes;
- `fetchSourceNaming()` and `saveSourceNaming()`; and
- `SourceDetailSheet` request and error handling.

Delete the migrated local browser naming types, the duplicate default profile,
the permissive domain validator body, reflective route parsing, inline
repository response types, and message-based missing-Source checks. Keep
temporary type re-exports from `engine.ts` only for unrelated naming UI callers.

## Verification

The implementation starts with failing tests.

1. Domain tests prove that invalid quantities and folder rules currently pass
   or normalize.
2. Route tests prove that invalid writes can succeed, that missing errors have
   no stable code, and that rejected writes must preserve exact metadata.
3. Browser tests prove that malformed successful JSON currently reaches
   feature code and that missing Sources require message inspection.
4. Contract tests cover both write variants, sparse response overrides,
   sparse role patches, malformed profiles, coded errors, and status
   mismatches.

The unit passes when valid settings round-trip, each invalid request returns a
coded error without changing Source metadata, malformed success data does not
reach `SourceDetailSheet`, and all duplicate Source naming definitions are gone.

## Arena record

Candidate A scored 58 of 60 and is the base. Candidate B scored 48 of 60.

The final design grafts Candidate B's exhaustive repository read and write
results and exact browser request-shape assertions. It rejects Candidate B's
full resolved override response because that shape would erase inherited-global
semantics and could freeze inherited fields on a later save.

The design also rejects a global `engineFetch()` change, duplicate contract and
domain validators, a new API file split, and silent repair of invalid stored
metadata.
