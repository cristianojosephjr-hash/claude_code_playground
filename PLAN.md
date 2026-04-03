# Cloudflare Workers Auth Recovery Plan

## Summary
Restore the `Cloudflare` plugin’s account authentication first, then verify real Workers access on account `892897b63066abdd897d63d050555ff0`. Current grounded state is:

- The available plugin capability is `cloudflare-api`; it supports Cloudflare API calls only.
- Live account inspection is currently blocked by `10000 Authentication error`.
- The user chose `Workers` as the target area and `Fix Auth First` as the plan goal.

Success means Cloudflare API reads succeed for the target account, Workers inventory is visible, and the session is ready for a follow-on Workers implementation plan.

## Implementation Changes
1. Restore plugin authentication in the Codex app:
- Open the `Cloudflare` plugin/account connection settings in the app.
- Reconnect or re-authorize the plugin against the intended Cloudflare account.
- Ensure the connected identity has access to account `892897b63066abdd897d63d050555ff0`.
- If the plugin supports scope selection, require read access for Workers and account resources at minimum.

2. Validate authentication with read-only API calls, in this exact order:
- `GET /accounts/{account_id}/workers/account-settings`
- `GET /accounts/{account_id}/workers/scripts`
- `GET /accounts/{account_id}/pages/projects`
- `GET /accounts/{account_id}/r2/buckets`
- `GET /accounts/{account_id}/d1/database`
This sequence proves the token is valid, the account is correct, and the accessible product surfaces are known.

3. Interpret failures deterministically:
- `10000 Authentication error`: plugin session/token is invalid or disconnected; repeat plugin re-auth.
- `403` or authorization-style denial: token is valid but lacks scope or account membership.
- `404` on Workers endpoints after auth succeeds: account mismatch or product not enabled on that account.
- Mixed success across endpoints: keep Workers as the primary surface and note restricted access elsewhere.

4. Capture post-auth Workers state once reads succeed:
- Record Worker script names, count, and whether any existing dispatch namespaces or routes are present.
- Record whether the account already has Pages, R2, or D1 resources, because that affects Worker binding options later.
- Use that inventory to drive the next plan: audit existing Worker vs create a new Worker.

5. Stop after environment truth is collected:
- Do not mutate Cloudflare resources yet.
- Do not create/update/delete Workers, routes, namespaces, or bindings in this phase.
- The next phase starts only after authenticated inventory is available.

## Important Interfaces
- Cloudflare MCP read path: `mcp__cloudflare_api__execute`
- Target account: `892897b63066abdd897d63d050555ff0`
- Primary validation endpoints:
  - `/accounts/{account_id}/workers/account-settings`
  - `/accounts/{account_id}/workers/scripts`

## Test Plan
1. Re-run `workers/account-settings`; expect HTTP `200`.
2. Re-run `workers/scripts`; expect HTTP `200` and a concrete result set, even if empty.
3. Re-run at least one non-Workers read (`pages`, `r2`, or `d1`) to confirm cross-product account access.
4. Confirm there is no remaining `10000 Authentication error`.
5. Confirm the resulting inventory is specific enough to choose between:
- extending an existing Worker
- creating a new Worker

## Assumptions
- The intended Cloudflare account is `892897b63066abdd897d63d050555ff0`.
- The user wants the Cloudflare plugin used for API work, not desktop automation.
- No repo-tracked code changes are part of this auth-recovery phase.
- After auth is restored, the next plan should pivot directly into a Workers implementation blueprint based on the real account inventory.
