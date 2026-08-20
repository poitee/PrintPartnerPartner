# Marketplace API feasibility

Research date: 2026-08-19

## Conclusion

None of Printables, MakerWorld, or Thangs publishes a supported third-party API
for the Source Library workflow. All three expose enough machine-readable data
to tempt an integration. That is not the same thing as a product contract.

Printables is technically the easiest but has the clearest stop sign. Its
current general terms prohibit unauthorized automated extraction and scraping.
Thangs has the same terms problem, and its formerly public model JSON endpoint
now presents a Cloudflare challenge to a plain client. MakerWorld has the most
useful public JSON and sitemap data, but no published schema, authentication,
rate-limit, or third-party-use contract.

Keep all three providers manual in the supported product. A later project can
run bounded metadata experiments, seek written provider approval, and promote
an adapter only after its contract is explicit.

## Classification used in this note

| Class | Meaning | Product status |
| --- | --- | --- |
| Supported API | The provider documents the endpoint, schema, authentication, limits, and intended third-party use. | Eligible for a supported adapter. None was found here. |
| Public undocumented endpoint | A request without a private session currently returns structured data. The provider makes no compatibility or rate promise. | Lab experiment only. |
| Browser-private endpoint | The website or first-party app supplies session state, bearer tokens, SSO tickets, or internal messages. | Do not call from PrintPartner without provider approval. |
| Sitemap or RSS | A provider-published discovery document. A sitemap is for search-engine indexing and does not define model revision semantics. | Discovery hint at most. No official model RSS feed was found. |
| Scraping | Parsing rendered HTML, browser state, or anti-bot challenges instead of a provider contract. | Do not ship. |

## Feasibility matrix

| Capability | Printables | MakerWorld | Thangs |
| --- | --- | --- | --- |
| Creator discovery | Native profiles and Community Feed. Undocumented GraphQL can list a user's models. | Public creator pages list published models. No supported creator API found. | Native profiles and follow notifications. An older first-party-supported Blender add-on used an undocumented search endpoint. |
| New-model monitoring | Technically possible through the `userModels` GraphQL query. Not supportable under current terms without permission. | A global sitemap and internal search data can reveal model URLs, but neither is a creator feed. Creator-page polling would be scraping. | Native user notifications exist. No external feed or webhook found. Automated collection is prohibited without authorization. |
| Model revision monitoring | File IDs, names, sizes, and file creation times are visible through undocumented GraphQL. No immutable model revision ID or documented update contract found. | Public design JSON includes design and print-profile `updateTime` values. They are not documented immutable revision IDs. | The 2025 model response captured by Manyfold contained `lastVersioned`, `versionCount`, per-part identifiers, and timestamps. The endpoint is undocumented and now challenged here. |
| Metadata and file listing | Undocumented GraphQL exposes model metadata and STL/other-file lists. | Undocumented design JSON exposes title, creator, license, tags, instances, plates, and timestamps. Raw-file completeness was not verified. | The older model JSON exposed metadata and parts. Manyfold deliberately reports `model_files: false` for its Thangs adapter. |
| Downloading | An undocumented `GetDownloadLink` mutation returns a temporary link and records download context. PrusaSlicer receives download URLs through its authenticated Printables webview. | Reverse-engineered clients report an authenticated instance-to-3MF endpoint. We did not test it because it requires a bearer token and may record a download. | No credible current public model-file download contract was found. Native UI download remains the supported user path. |
| Authentication | Public GraphQL reads worked without login in one bounded check. PrusaSlicer injects account access into its embedded webview for authenticated actions. | One public design-detail request worked without login. First-party clients use SSO and bearer-authenticated flows for other operations. | The former public model endpoint required no auth in Manyfold's 2025 recording. Current plain access received a Cloudflare challenge. |
| Published rate limits | None found. | None found. | None found. |
| Terms and license risk | Current PRUSA terms prohibit unauthorized automated extraction and scraping. Each model also carries its own license. | No automation permission was found. Per-model licenses can prohibit sharing, hosting, transfer, or commercial use. | Terms prohibit unauthorized collection, scraping, spidering, and harvesting. Per-model licenses still govern downloaded files. |
| Likely breakage | High. GraphQL operation names and fields are browser implementation details. | High. Region hosts, schemas, SSO, Cloudflare, and download rules can change independently. | Very high. A previously working JSON endpoint already differs from the current plain-client result. |

## Provider evidence

### Printables

Printables documents browsing and downloading through its website embedded in
PrusaSlicer, not through a developer API. The integration supports registered
and unregistered browsing. Download and login actions are passed from the page
to the slicer.
[Official Printables in PrusaSlicer documentation](https://help.prusa3d.com/article/printables-in-prusaslicer_822448)
[PrusaSlicer webview download and login handlers](https://github.com/prusa3d/PrusaSlicer/blob/b028299c770b8380ee81c921a2867d522f288123/src/slic3r/GUI/WebViewPanel.cpp#L1539-L1594)

The public but undocumented endpoint at
[`api.printables.com/graphql`](https://api.printables.com/graphql/) accepted an
unauthenticated `ModelFiles` query during this research. It returned a model ID
and an STL with file ID, name, creation time, and size. This confirms technical
availability on one date, not support. An open-source CLI uses the same GraphQL
service for search, file listing, and the temporary-link download mutation.
[CLI search and model-file queries](https://github.com/GhostTypes/printables-cli-api/blob/d03ee133b72ee8a5d001add983cab0ec61dc2599/printables_api.py#L19-L54)
[CLI temporary download-link mutation](https://github.com/GhostTypes/printables-cli-api/blob/d03ee133b72ee8a5d001add983cab0ec61dc2599/printables_api.py#L56-L115)

There is no official model RSS feed. One small open-source worker creates its
own RSS feed by calling the undocumented `userModels` GraphQL query and sorting
on `first_publish`. That code is useful evidence of feasibility, but it is not
a provider feed.
[Unofficial Printables RSS worker](https://github.com/splitbrain/cloudflare-prusa-rss/blob/ba37eb3b58b9d117f1d4813d034e19bd85b56fdb/src/index.js#L18-L105)

The legal boundary is unambiguous. PRUSA's current general terms tell users to
refrain from unauthorized copying, automated extraction, scraping, artificial
query inflation, and unreasonable load. Printables also advertises a sitemap
in `robots.txt`, but that does not override the terms or define an API.
[PRUSA website terms, section 9](https://www.prusa3d.com/page/general-terms-and-conditions_231226/#9-permitted-use-and-copyright)
[Printables terms](https://www.prusa3d.com/page/terms-of-service-of-printables-com_231249/)
[Printables robots file](https://www.printables.com/robots.txt)

Assessment: do not ship GraphQL polling or automated downloads. The safe next
step is provider outreach plus a manual archive-import spike.

### MakerWorld

Bambu Studio's first-party source calls Bambu's cloud design service for model
metadata and uses MakerWorld SSO tickets in an embedded webview. This proves
that the service is part of Bambu's own client architecture. It does not grant
third-party access.
[Bambu Studio design-service request](https://github.com/bambulab/BambuStudio/blob/9a530f77c23d8c3430d1dbef02e103cd8bd6480e/src/slic3r/GUI/Project.cpp#L251-L276)
[Bambu Studio MakerWorld SSO handling](https://github.com/bambulab/BambuStudio/blob/9a530f77c23d8c3430d1dbef02e103cd8bd6480e/src/slic3r/GUI/WebViewDialog.cpp#L1329-L1414)

A bounded unauthenticated request to the public but undocumented
[`design/{id}` endpoint](https://api.bambulab.com/v1/design-service/design/21901)
returned title, creator, license, design `updateTime`, and print instances with
their own timestamps. There were no documented cache, version, or rate
semantics. Treat those timestamps as change hints only.

The public [MakerWorld sitemap index](https://makerworld.com/sitemap.xml) leads
to model sitemaps with canonical model URLs and `lastmod`. The sitemap has many
locale duplicates and does not associate each URL with a creator. It is useful
for global discovery research, not creator subscriptions or file revision.

OpenBambuAPI documents endpoints reverse-engineered from Bambu Handy traffic,
including design detail and bearer-authenticated 3MF download. Its own heading
labels them undocumented. This is good evidence of how a community client
works, not evidence that the calls are supported.
[OpenBambuAPI MakerWorld notes](https://github.com/Doridian/OpenBambuAPI/blob/cc383a2c96576a9f53391c879acfb8dca5c534e4/cloud-makerworld.md#makerworld--design-services-api)

MakerWorld models can use Creative Commons licenses or MakerWorld's Standard
Digital File License. The latter can prohibit sharing, hosting, transfer, and
commercial use. PrintPartner must preserve the displayed license and never
redistribute imported bytes merely because a download URL was reachable.
[MakerWorld user agreement](https://makerworld.com/en/user-agreement)
[Example Standard Digital File License on a model](https://makerworld.com/en/models/997038-gridfinity-desiccant-container-for-bambu-spool-ams)

Assessment: a metadata-only lab adapter is plausible after a terms review. Do
not reuse Bambu account tokens, automate downloads, or ship against internal
JSON without written approval.

### Thangs

Thangs documents native follow notifications and email for new models. It does
not document an external feed, webhook, or model API.
[Official Thangs social-feature documentation](https://thangs.com/resources/blog/how-to-use-social-features-on-thangs)

Manyfold, a mature open-source 3D-model manager, calls the undocumented
`/api/models/{id}` endpoint for public metadata. Its captured July 2025 response
contained model and part timestamps, `versionCount`, identifiers, license
location, and owner data. Manyfold's capability declaration still marks model
files and license extraction unsupported.
[Manyfold Thangs request](https://github.com/manyfold3d/manyfold/blob/9b5950707a973d95c1a6088dcd8be810fdfebe17/app/deserializers/integrations/thangs/base_deserializer.rb#L13-L24)
[Captured 2025 response](https://github.com/manyfold3d/manyfold/blob/9b5950707a973d95c1a6088dcd8be810fdfebe17/spec/cassettes/Integrations_Thangs_ModelDeserializer/success.yml#L1-L38)
[Manyfold capability boundary](https://github.com/manyfold3d/manyfold/blob/9b5950707a973d95c1a6088dcd8be810fdfebe17/app/deserializers/integrations/thangs/model_deserializer.rb#L19-L30)

The same endpoint returned a Cloudflare challenge to a plain unauthenticated
request during this research. PrintPartner must not imitate a browser or evade
that challenge. Thangs' terms prohibit unauthorized collection, scraping,
spidering, and harvesting. Its content policy separately prohibits automated
scraping or bulk downloading.
[Thangs terms](https://thangs.com/resources/legal/terms-and-conditions)
[Thangs content policy](https://thangs.com/resources/legal/content-policy)
[Thangs robots file](https://thangs.com/robots.txt)

Assessment: stop network-adapter work until Thangs grants access or publishes a
developer contract. Manual imports remain viable.

## Candidate code worth studying

These repositories are evidence, not dependencies or endorsements.

| Project | What it proves | Why not copy it directly |
| --- | --- | --- |
| [PrusaSlicer Printables webview](https://github.com/prusa3d/PrusaSlicer/blob/b028299c770b8380ee81c921a2867d522f288123/src/slic3r/GUI/WebViewPanel.cpp#L1159-L1217) | The first-party flow keeps Printables in a webview and handles explicit download/login messages. | It has first-party trust, allowlists, and account integration that PrintPartner does not have. |
| [GhostTypes Printables CLI](https://github.com/GhostTypes/printables-cli-api/blob/d03ee133b72ee8a5d001add983cab0ec61dc2599/printables_api.py#L56-L182) | Current GraphQL shapes can expose files and temporary download links. | It also scrapes descriptions with `cloudscraper`; schema and terms risk are unresolved. |
| [OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI/blob/cc383a2c96576a9f53391c879acfb8dca5c534e4/cloud-makerworld.md) | Bambu Handy traffic contains rich MakerWorld discovery and download calls. | It is explicitly reverse-engineered and bearer-token based. There is no support promise. |
| [Bambu Studio](https://github.com/bambulab/BambuStudio/blob/9a530f77c23d8c3430d1dbef02e103cd8bd6480e/src/slic3r/GUI/Project.cpp#L251-L276) | A first-party client uses the design service and separates some public calls from SSO flows. | First-party use does not authorize a server-side third-party integration. |
| [Manyfold Thangs adapter](https://github.com/manyfold3d/manyfold/tree/9b5950707a973d95c1a6088dcd8be810fdfebe17/app/deserializers/integrations/thangs) | Public model metadata was machine-readable in 2025, while file import remained unsupported. | Current access behavior changed, and Thangs' terms prohibit unauthorized collection. |
| [Thangs Blender add-on](https://github.com/randyhucker-physna/thangs-blender-addon/blob/ea31a8690214c280f5ed8e0ddc9ff26f24c3cd3b/thangs_fetcher.py#L244-L359) | A Thangs-supported open-source add-on used search metadata, thumbnails, attribution links, and telemetry. | It does not expose a general download or monitoring contract for unrelated products. |

## Safe feasibility spikes

1. Build a provider-neutral fixture harness. Feed it saved, hand-reviewed JSON
   and user-downloaded archives. Prove ID normalization, manifests, revision
   diffs, license capture, and failure classification without live polling.
2. Ask each provider for developer access and written permission covering
   metadata polling, creator subscriptions, file downloads, local retention,
   authentication, and rate limits. A verbal "the endpoint is public" is not
   enough.
3. Printables: test only manual URL intake and user-supplied archives until
   permission changes the terms boundary. Do not run the GraphQL RSS pattern.
4. MakerWorld: run a live local metadata-only canary only after written
   provider approval. It may fetch one public design ID and one sitemap page at
   a low fixed rate, storing response hashes and field presence. Without that
   approval, use saved fixtures only. Never send cookies, bearer tokens,
   download calls, or browser-identification headers.
5. Thangs: do not probe past the current challenge. Test canonical URLs and
   manual archive imports offline. Resume live work only with provider approval
   or published developer documentation.

## Later-project plan

### Stage 1: contract and fixtures

Get provider answers, save redacted fixtures, and implement adapters against
fixtures only. Define the exact provider ID, revision key, file manifest, and
license fields needed by PrintPartner.

### Stage 2: read-only canary

Run only provider-approved metadata calls. One credential and one creator are
enough. Record status, latency, cache headers, schema hashes, rate headers, and
successful behavior for at least 30 days. The first unexpected `403`, `429`, or
anti-bot challenge stops the canary immediately; record that terminal response
but do not retry it during the observation period. No downloads and no Build
changes.

### Stage 3: user-initiated import

If the provider approves downloads, require a user action for each import.
Validate size, type, license, and archive completeness before creating an
immutable Source revision. Never reuse browser cookies or first-party app
tokens.

### Stage 4: monitored adapter

Enable scheduled checks only after the provider supplies stable revision
semantics and limits. Ship behind a provider-specific feature flag with a kill
switch, slow defaults, conditional requests, backoff, and manual fallback.

## Stop conditions

Stop the spike or disable the adapter if any of these occurs:

- the flow needs a private session cookie, copied bearer token, SSO ticket,
  CAPTCHA solver, browser impersonation, or Cloudflare bypass;
- the provider's terms prohibit the intended automation or the provider denies
  permission;
- a normal request receives `401`, `403`, `429`, or an anti-bot challenge;
- no stable provider item ID or immutable revision key can be established;
- download calls change counters or other remote state without clear user
  action;
- paid, private, membership, or otherwise access-controlled files appear;
- the license cannot be captured and shown before import;
- response fields drift during the canary or there is no usable rate policy;
- the adapter would need HTML parsing to remain functional.

Until those conditions clear, the right product is the one PrintPartner
already understands: preserve the Source URL, open the provider for the user,
and turn the user's downloaded files into an immutable local revision.
