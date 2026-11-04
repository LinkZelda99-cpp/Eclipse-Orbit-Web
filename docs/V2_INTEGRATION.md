# Eclipse Orbit Web V2 Knowledge Integration

## Modes

### Companion mode
Use Desktop-owned Knowledge through Companion-connected chat. Today, Desktop can attach matching installed local Knowledge excerpts to normal chat prompts; a dedicated Knowledge search endpoint over the bridge is not implemented. Desktop remains the owner of installed packages and local indexes. Cloud synchronization is not implemented.

### Standalone mode
May query a future public Knowledge API when a cloud endpoint is configured and available. No such service is deployed yet. It must disclose that cloud retrieval is being used. Browser-local storage is not equivalent to Desktop's offline package library.

## Contract

Use a versioned, provider-neutral HTTP API. Initial planned endpoints:

- `GET /v1/knowledge/capabilities`
- `POST /v1/knowledge/search`
- `GET /v1/knowledge/sources/{sourceId}`
- `GET /v1/knowledge/versions/{technology}`

The API must enforce request limits, bounded result counts, timeouts, rate limits, and safe CORS policy. Do not embed service credentials or signing secrets in static JavaScript. Public search endpoints should expose only published corpus records and must not accept user memory or workspace uploads.

Search results include source URL, source authority, license/attribution, technology version, and freshness metadata. The UI must distinguish cached, offline, and live-cloud results.

## Degraded operation

- No network: continue normal local-model chat; show Knowledge Cloud unavailable.
- Cloud error: do not block chat or Companion mode.
- Desktop unavailable: standalone mode remains available within its existing scope.
- Unsupported API version: disable Knowledge integration with a clear compatibility message.
- Empty results: report no matching indexed source rather than inventing a citation.

## Scope honesty

The current standalone client does not yet implement Knowledge retrieval, offline knowledge packages, voice, or the Coding Agent. These remain V2 work until implemented and tested.
