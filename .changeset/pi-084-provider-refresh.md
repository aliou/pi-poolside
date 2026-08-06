---
"@aliou/pi-poolside": patch
---

Add Pi coding-agent 0.84 compatibility for the provider model refresh: catalog reads and persistence now go through a runtime shape-detection shim (`extensions/provider/refresh-store-compat.ts`) that uses the 0.84 `context.stored` snapshot and `context.publish({ persist })` transaction when available, and falls back to the legacy `context.store` read/write on older hosts. Fallback behavior is unchanged: cached models win when present, otherwise the static POOLSIDE_MODELS_CACHE; no network access when disallowed or aborted, and no API key means fallback models. The `@earendil-works/pi-coding-agent` peer range drops its <0.81.0 cap and now supports both pre-0.84 and 0.84+ hosts.
