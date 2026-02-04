# Origin Shield Guidelines (Profile A)

Purpose: prevent invalid or abusive requests from reaching the data plane.

## Requirements
- Reject invalid `sv` early (edge or origin) with 401/403.
- Unknown allowlist values must return 400 (not cached).
- Include `Cache-Control: no-store` on rejection responses.
- Include `X-Origin-Block-Reason` to make rejection cause observable.

## Suggested headers

For invalid/missing sv:
```
Cache-Control: no-store
X-Origin-Block-Reason: sv_missing | token_expired | signature_invalid | ...
```

For allowlist rejections:
```
Cache-Control: no-store
X-Origin-Block-Reason: param_not_allowlisted
```

## Integration (edge or origin)

- Edge/CDN can mirror these checks to protect the origin.
- The origin should still enforce sv + allowlists as a backstop.
- Log rejections with request id + path to support audits.

