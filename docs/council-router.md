# Router + Council

One Council retains ownership of planner/researcher/tutor/auditor/verifier/critic/synthesizer. The native router selects a generation path for each stage; it does not start a second Council. Simple/Instant retain their existing paths. Medium/High use routed helper stages and the existing authorized final provider.

## Server configuration

- `OPENROUTER_API_KEY`: optional server secret; never placed in browser settings or public status.
- `OPENROUTER_FREE_MODEL`: existing single-model configuration remains compatible; default `openrouter/free`.
- `OPENROUTER_FREE_MODELS`: optional comma-separated free model IDs, in preference order. Paid IDs are discarded. Maximum eight candidates, three attempts per stage.
- `OPENROUTER_FREE_STAGE_MODELS`: optional JSON object mapping stage names to arrays of permitted free IDs, e.g. `{"critic":["openrouter/free"],"verifier":["openrouter/free"]}`. A known, currently available named `:free` model may be substituted by an administrator after checking its provider terms/capabilities. Role preferences fall back to global candidates; unused candidates are preferred to reduce identical reviewers, not to claim independent consensus.

Every helper request enforces zero input/output maximum price and rejects data-collection providers. A role label does not grant tools: these helpers only analyze supplied text; actual Web/RAG retrieval stays in the existing source pipeline. No new paid helper fallback or model picker is introduced. The final synthesizer retains the user's existing authorized provider, budget, output-length policy and provider fallback; it is not guaranteed zero-cost.

Requests have a shared 35-second helper budget, up to six seconds per attempt and 18 seconds per stage. Model errors cool down that model; rate-limit/auth/billing errors stop provider retries rather than hopping models to bypass account quotas. Cooldowns are warm-instance state, not a durable distributed quota ledger. Deployment replicas still rely on upstream quota enforcement. Missing credentials, failures or exhausted budgets use structural local guidance, explicitly not independent LLM verification.

`/api/integrations/status` reports the router policy and helper configuration without keys; authenticated ask responses include per-stage route decisions without prompts. OmniRoute is not installed or exposed. Future gateway adapters need separate authenticated hosting, provider-use and privacy review; no automatic proxy credential transfer.
