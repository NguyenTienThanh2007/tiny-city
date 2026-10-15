# Performance

All figures were measured on an Apple Silicon laptop with Node 24 and hardware-accelerated Chromium.

## Headless: one full week (`node --expose-gc scripts/p7_benchmark.mjs`)

Each town has homes, offices and entertainment venues on the connected test grid, and runs 7 game days (10,080 ticks) with the economy and transport on. The society is off in one run and on in the other.

| Town | Residents | Society | Avg tick | p95 tick | Worst tick | Outings / day | Relationships | Friends | Event attendance (week) | Retained heap | Save |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ~20 | 16 | off | 0.026 ms | 0.078 ms | 6.6 ms | — | — | — | — | 2.0 MB | 46 KB |
| ~20 | 16 | on | 0.037 ms | 0.094 ms | 8.3 ms | 19 | 31 | 6 | 9 | 1.2 MB | 60 KB |
| ~100 | 88 | off | 0.060 ms | 0.203 ms | 8.5 ms | — | — | — | — | 0.4 MB | 128 KB |
| ~100 | 88 | on | 0.128 ms | 0.281 ms | 3.4 ms | 102 | 262 | 40 | 92 | 1.0 MB | 188 KB |
| ~300 | 268 | off | 0.265 ms | 0.752 ms | 27.1 ms | — | — | — | — | −0.3 MB | 297 KB |
| ~300 | 268 | on | 0.447 ms | 0.823 ms | 6.4 ms | 239 | 645 | 38 | 115 | 0.7 MB | 467 KB |
| ~1000 | 896 | off | 0.728 ms | 1.92 ms | 8.2 ms | — | — | — | — | 1.5 MB | 881 KB |
| ~1000 | 896 | on | 1.454 ms | 2.51 ms | 9.4 ms | 402 | 1,489 | 22 | 60 | 1.3 MB | 1,349 KB |

- **Cost per tick.** The society adds about 0.1 ms at 100 residents and 0.7 ms at about 900. One tick is one game minute: at 1× there are 10 ticks per real second, about 15 ms of simulation per second at 900 residents. At 4× that is about 58 ms per second, roughly 6% of a 60 fps frame budget. Worst ticks (the day's settlement and early-evening decision peaks) stay under 10 ms with society on. The 27 ms off-run worst tick is the Phase 6 first-day settlement plus routing warm-up.
- **Bounded work.** Decisions run on staggered 15-minute slots (about 1/15 of residents per tick). Venue searches look at the nearest 3 venues per type. Relationships update only for residents actually together, and there are no all-pairs scans.
- **Memory.** Retained heap after a week is the same with or without society (1–2 MB, within noise), because state is bounded (see persistence-and-migration.md).
- **Save size.** The society adds about 0.5 KB per resident: +468 KB at 896 residents, including relationships (1,489 edges, under the 10-per-resident bound).
- **Friendships at scale.** In the 896-resident town only 22 pairs reached friendship within a week. Contact is spread across many more people, and the daily gain cap makes friendship take repeated contact. Acquaintances (1,489) form quickly.

## Browser (`node scripts/p7_render_benchmark.mjs`)

Coral Bay Nights has 240 residents and 62 buildings, including 14 venues and 3 district apartment blocks. It was loaded at real engine-built moments, run live, and sampled for 10 s per row from the renderer's own stats.

| Moment | View | Speed | FPS avg (min) | Pixi frame callback avg (max) | Residents drawn | Vehicles drawn |
|---|---|---|---|---|---|---|
| Monday 18:00 | city | 1× | 59.3 (59) | 1.06 ms (1.29) | 127 | 68 |
| Monday 18:00 | district close-up | 1× | 59.2 (58) | 0.97 ms (1.10) | 102 | 54 |
| Monday 18:00 | district close-up | 4× | 59.2 (58) | 0.32 ms (0.80) | 46 | 23 |
| Friday 20:45 (concert, market, lights) | city | 1× | 59.3 (58) | 0.68 ms (0.98) | 94 | 20 |
| Friday 20:45 | district close-up | 1× | 59.2 (58) | 0.37 ms (0.50) | 30 | 14 |
| Friday 20:45 | district close-up | 4× | 58.6 (56) | 0.24 ms (0.65) | 67 | 18 |
| Saturday 15:00 | city | 1× | 56.2 (30*) | 0.66 ms (1.39) | 43 | 14 |
| Saturday 15:00 | district close-up | 1× | 58.8 (56) | 0.53 ms (0.62) | 64 | 14 |
| Saturday 15:00 | district close-up | 4× | 59.4 (57) | 0.47 ms (0.62) | 46 | 16 |

\* The first second after loading (texture upload); every later sample was 56 fps or more.

The venue atlas is one extra page (plus its soft page). Venue crowds reuse the character sprites and draw only real visitors.
