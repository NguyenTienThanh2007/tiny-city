# AI Architect 2.0

AI Architect 2.0 keeps the Phase 2 architecture:
- the AI interprets intent;
- the deterministic TypeScript planner and simulation decide legality, cost, geometry, housing and safety;
- nothing changes until the user approves a preview.

It adds reliable diagnostics, target-aware natural-language commands, explicit clarification and authorization,
and impact summaries.

## Root cause of the reported failure

| Symptom | Exact response | Cause |
| --- | --- | --- |
| "Planner online · readiness unknown" | `GET http://127.0.0.1:8000/v1/city/status` returned `404 {"detail":"Not Found"}` | Port 8000 (the old default and the dev-proxy target) was held by another local FastAPI app, "F01 API". The client treated any 404 as an older TINY CITY API. |
| "The planning service returned an invalid error response." | `POST http://127.0.0.1:8000/v1/city/plan` returned `404 {"detail":"Not Found"}` | Same app. The body was not the planner's `{requestId, error}` contract, so the client could only say "invalid error response". |

The real TINY CITY API worked when started on a free port. `GET /v1/city/status` returned
`{"service":"tiny-city-api","provider":{"mode":"gemini","configured":true,"model":"gemini-3.5-flash-lite"},"planner":"ready"}`,
and a live `POST /v1/city/plan` for "Xây 2 biệt thự gần công viên" returned `200 VALIDATED` with two placements.

A second, latent bug was found while testing failure paths. A plan request that failed very quickly could hang
forever, because the disconnect monitor's cancellation was swallowed inside Starlette's `is_disconnected()`. It now
stops through an explicit event.

## Reliability changes

- **Backend:** every `/v1` failure uses the error contract: unknown route (`NOT_FOUND`), wrong method
  (`METHOD_NOT_ALLOWED`), invalid request, and unexpected errors (`INTERNAL_ERROR`, retryable, no internals).
- **Status:** `/v1/city/status` reports `service: "tiny-city-api"`, `contractVersion` and the non-secret model name.
- **Client: identifying a 404.** When the status route returns 404, the client asks `/health` and `/openapi.json`
  who is answering:
  - an older TINY CITY API is shown as "reachable";
  - anything else is shown as **Wrong service on the planner port (name)**, with steps.
- **Client: other failures.** Non-contract failures become actionable codes that carry the HTTP status:
  `PLANNER_NOT_FOUND` (404/405), `PROVIDER_UNAVAILABLE` (5xx, retryable), `REQUEST_TOO_LARGE` and
  `PLANNER_HTTP_ERROR`. The recovery card keeps the prompt and offers Retry and Check connection.
- **Ports:**
  - the default API port is now **8787** (dev proxy, production default, docs);
  - `npm run dev:api` starts the API, refuses an occupied port, names the program holding it, and suggests a free
    one (`TINY_CITY_API_PORT` is shared with `npm run dev`).
- **Provider modes:**
  - `gemini`: paid interpretation;
  - `mock`: the fixed demo fixture used by the existing CI specs;
  - `local`: the deterministic offline Vietnamese/English rules interpreter (`interpretLocally`) with no AI calls.
  - Modes are explicit; Gemini never silently falls back.

## Commands and targets

The intent adds optional fields; Phase 2 intents without them plan identically (tested by digest):

| Field | Meaning |
| --- | --- |
| `demolishTargets[]` | `{buildingType, ids, quantity, all, relative}` |
| `moveTargets[]` | `{target, near: existing\|park\|road\|center, position}` |
| `preserveRoads` | Road removals become a conflict, never applied |
| `preserveTypes[]` | Building types the user asked to keep |

`resolveTarget` (`packages/ai-architect/src/targets.ts`) resolves a target against the live world deterministically:

| Situation | Result |
| --- | --- |
| Named or explicit IDs | Must exist and match the type |
| `all` | Every building of that type |
| `relative` | `left`/`right`/`back`/`front` along the isometric screen axes. A tie at the cut-off asks instead of guessing. |
| Exactly as many matches as requested | Those buildings |
| More matches than requested | Clarification: the user picks exactly `quantity` |
| Fewer matches, or none | Rejected with the real count ("You asked for 3 apartment buildings, but the city has 2"); quantities are never reduced |

Supported phrasing (offline rules and Gemini instructions):

| Kind | Vietnamese | English |
| --- | --- | --- |
| Build | xây, xây dựng, thêm, tạo | build, add, create, construct, place |
| Demolish | phá, phá bỏ, dỡ, xóa | demolish, remove, tear down, delete, destroy, bulldoze |
| Move | di chuyển, dời | move, relocate |
| Keep | giữ, giữ nguyên, bảo tồn, không phá | keep, preserve, protect |
| Building types | biệt thự, nhà song lập, nhà phố, chung cư / căn hộ / tòa chung cư, công viên, câu lạc bộ, hồ bơi / bể bơi, trung tâm thương mại / siêu thị, văn phòng / cao ốc | singular and plural names |
| Quantities | digits, một…hai mươi, tất cả / mọi / toàn bộ / hết | digits, a/an, one…twenty, both, all/every |
| Places | gần công viên, gần đường, trung tâm | near the park, near a road, center |
| Directions | bên trái/phải, phía trên/dưới | left/right, top/bottom |
| Roads | "thêm đường kết nối" connects roads; "đường tại 30,20" adds or removes a tile | "connect roads"; "road at 30,20" adds or removes a tile |

Unsupported buildings (hospital, school, factory…), road removal without tiles, and unclear requests are reported,
never substituted.

## Safety: clarification and authorization

1. **Ambiguous target.** The proposal is `REJECTED` with `clarifications[]`, a candidate list with names and
   positions. The Plan panel lists the candidates and highlights them on the map with a Show button.
   - "Use these buildings" re-plans the **same interpreted intent** through `/v1/city/plan/validate`, with no second
     AI call.
2. **Protected or destructive edit.** The proposal is `REJECTED` with `authorization`:
   `{demolish, move, protectedIds, destructiveRequired, message}`.
   - The panel explains the conflict with "Protect existing buildings" and lists exactly what would change.
   - "Allow these changes" lifts protection and allows demolition for exactly those IDs; every other building stays
     protected. "Keep protection" cancels.
3. **Preview.** The validated plan is previewed without mutating the live city. Removed buildings are red, moved
   ones blue, new ones green. The impact list shows:
   - rooms added or removed;
   - residents who will leave the city or move home;
   - whether the player's home is removed;
   - rooms kept for a waiting character.
4. **Apply.** Destructive plans still need "Review destructive edits" then "Confirm & apply".
   - `PlanReview` re-validates the revision, fingerprint and digest, then applies one atomic batch.
   - Undo/redo and save/load work as before. A manual edit makes the preview stale.

## Planning quality

- **Placement:** among the nearest legal lots, the planner prefers lots that already touch a road, then the fewest
  new road tiles. Later buildings in the same request anchor on those already placed, so neighborhoods stay together.
- **Moves:** "gần đường" / "next to a road" only accepts lots that already touch a road.
- **Explanations** describe what the plan does: new buildings, moves, exact removals, road tiles.
- **Unchanged guarantees:** exact quantities, budget including road costs, the operation limit, connected roads,
  population reconciliation, and the Life Mode housing rules.

## Housing integration

- AI batches go through the same `applyCityCommandBatch`, so `reconcilePopulation` and `reconcilePlayer` apply.
- A waiting (unplaced) character keeps one room in AI-built housing, and the move-in that follows succeeds (unit and
  e2e tests).
- Demolishing the player's home through AI is shown in the impact before approval. The player then loses the home
  and can move into another.
