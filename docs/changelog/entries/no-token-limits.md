# No call limits on tokens · 8 Oct 2026

JuanMail spent Juan's token's 2,000 daily calls on 7 Oct, and his Mac tools share that token. Juan: "remove token
limits for PLCOS -- re-implement them only after we find a need for them".

MCP and REST calls are no longer limited: no daily budget, no per-minute rate, and no `X-RateLimit-*-Day` headers. A
token is still refused outside its tools or after it expires, and every call is still audited. The stored per-token
figure and the config values are kept, unused, for when a limit is wanted again.
