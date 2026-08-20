# Browser contract transport architecture

## Decision

New browser API families use explicit endpoint descriptors and the parsed JSON
runner in `contractRequest.ts`. Each descriptor owns its method, safe route
template, live path builder, request encoder, success parser, and safe error
projection.

The existing generic `engineFetch<T>()` stays unchanged while callers migrate
one feature family at a time. It remains an explicitly unvalidated legacy path.
Changing every caller before its runtime contract exists would alter failure
behavior without making successful payloads trustworthy.

Source naming is the first migrated family. Its endpoint code lives in
`api/endpoints/sourceNaming.ts`. `engine.ts` re-exports the public functions so
existing components do not need a simultaneous import migration.

## Endpoint boundary

Read and write endpoints use different types. A read cannot acquire a request
body. A write must encode its input before fetch. Both forms require runtime
success and failure parsers.

The descriptor declares a literal route such as
`/sources/:sourceId/naming`. The transport records that template and never
derives error data from the live URL. Route definitions reject absolute URLs,
query strings, fragments, empty strings, and protocol-relative paths.

Path building and request encoding happen inside the boundary. An invalid
Source ID or request body becomes `invalid_request` before fetch. The rejected
value and parser exception are discarded.

## Failure boundary

`ContractRequestError` exposes one discriminated failure with these kinds:

- `invalid_request`;
- `transport`;
- `unauthorized`;
- `endpoint`;
- `malformed_success`; and
- `malformed_error`.

Failures retain only the method, literal route template, status, approved trace
IDs, and a feature-specific safe error projection. Trace IDs come only from
`x-request-id` and `x-correlation-id`, are at most 128 characters, and use an
ID-only character set.

The Source naming projection keeps only the stable error code. It discards the
wire `detail` field because that field accepts free-form text. UI messages come
from a local code-to-message table.

The boundary does not retain the live path, query, request headers, request
body, response headers, response payload, provider data, fetch exception,
parser exception, or error cause.

## Response handling

The runner requires JSON media types for this endpoint class. It reads the body
once as `unknown`, then calls the descriptor parser. Valid JSON with the wrong
shape is malformed. A non-success response becomes `endpoint` only after its
error parser accepts the status and payload.

A `401` invokes the shared unauthorized callback and returns a redacted
`unauthorized` failure. Callback errors are discarded. Safe trace IDs remain
available.

Empty, text, stream, and blob responses need separate explicit endpoint types.
They are not generalized until a migrated endpoint requires them.

## Arena record

Candidate B won 64 to 51. Its descriptor-owned request encoding and safe error
projection made it the base.

The final design grafts Candidate A's route-template validation, narrow parser
catch scopes, legacy-call count, server-log follow-up, and strict Phase 5
closure condition. It rejects Candidate A's full parsed error retention and
generic request initialization because both could carry data outside the
allowlist.

The uncommitted global transport draft was rejected. It still cast successful
JSON to `T`, guessed route templates from live URLs, and retained arbitrary
server `detail` strings.

## Migration and closure

After Source naming, `engine.ts` has 173 legacy JSON call sites, two legacy text
call sites, and 12 direct fetch sites. These counts are migration evidence, not
a permanent allowlist.

For each feature family:

1. Add shared input, success, and error contracts.
2. Add endpoint descriptors and malformed-response tests.
3. Migrate the family to the parsed runner.
4. Delete its duplicate browser types and unsafe casts.
5. Record the new legacy count.

Phase 5 remains open until JSON and non-JSON endpoints have explicit contracts,
direct fetch paths follow the same redaction policy, server request logging no
longer records live URLs or raw error material, and the legacy generic helpers
are deleted.

## Verification

The first transport unit proves:

- valid Source naming responses parse;
- valid JSON with an invalid success shape is rejected;
- malformed errors remain distinct from valid endpoint errors;
- invalid Source IDs fail before fetch;
- only safe error codes and trace IDs survive;
- path, query, body, headers, payloads, and thrown exceptions do not survive;
- the unauthorized callback cannot replace the redacted error; and
- legacy callers keep their previous transport behavior.
