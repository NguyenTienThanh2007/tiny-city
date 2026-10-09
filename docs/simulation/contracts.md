# Public simulation contracts

Import runtime functions and types from `@tiny-city/simulation`, and sample worlds from `@tiny-city/simulation/fixtures`. The package exports ESM JavaScript and TypeScript declarations after building.

## Data model

All interface properties and arrays are readonly. Worlds created by `createWorld`, fixtures, and `Simulation` are deeply frozen at runtime. Constructor inputs and queued commands are copied; caller-owned objects remain mutable. `cloneWorld` returns a detached copy with the same readonly TypeScript contract.

| Interface | Fields and meaning |
| --- | --- |
| `WorldState` | `schemaVersion: 1`, `id`, `plan`, `clock`, `randomState`, `citizens` |
| `CityPlan` | `id`, `name`, positive integer `width` and `height` in tiles, `buildings` |
| `Building` | `id`, `name`, `kind`, integer top-left `position`, positive integer `footprint.width/height`, nonnegative integer `capacity` |
| `Citizen` | `id`, `name`, `homeBuildingId`, nullable `workBuildingId`, fractional tile `position`, `activity`, nullable `targetBuildingId`, `schedule` |
| `DailySchedule` | Nonempty `entries` array of `ScheduleEntry` |
| `ScheduleEntry` | `startMinute`, `activity`, nullable `targetBuildingId` |
| `ClockState` | `tick`, `fixedStepMs`, `minutesPerTick`, `accumulatedMs`, `paused` |

`BuildingKind` is `home | workplace | park`. `CitizenActivity` is `sleep | home | work | leisure | idle`. Nullable references use explicit `null`; required fields are never omitted. Building IDs and citizen IDs are unique within their respective collections. References must resolve to existing buildings, but no occupancy or building-kind restriction is enforced.

Coordinates use x to the right and y downward. The plan spans `[0, width) × [0, height)`. Building positions are footprint origins, while citizen positions are points. The renderer chooses screen projection, scale, anchors, colors, sprites, and textures. No visual metadata is stored in the world.

Schedule entries begin at minute 0, strictly increase, and use integer minutes below 1440. Each entry remains active until the next entry or midnight. Schedules repeat daily. At each tick, the runner selects the entry containing the new minute of the day. If a tick jumps past several entries, only the entry at the resulting time is selected. Initial citizen activity/target values are authored snapshot values; the runner reconciles them on the first executed tick.

World validation checks typed local snapshots for invalid sizes, coordinates, IDs, references, schedules, clock values, and random state. `validateWorld` is not a decoder for arbitrary untrusted JSON. Valid serialized snapshots can be restored through `new Simulation(snapshot)`; a future network/persistence boundary should add explicit shape decoding after contract coordination.

`createWorld({ id, plan, citizens?, seed?, clock? })` validates, copies, and freezes a new world at tick 0. Citizens default to an empty array, the seed defaults to numeric 0, and `clock` accepts the same configuration as `createClock`. Use the fixture factories for ready-made examples. `validateSchedule(schedule, plan)` checks a schedule's ordering and building references; both validators return `void` on success and throw on invalid data. `cloneWorld(world)` copies every contract object and array without freezing the copy.

## Clock

`createClock(options?)` starts at tick 0. Defaults are `fixedStepMs: 100`, `minutesPerTick: 1`, and `paused: false`. Both increments must be positive safe integers. Tick count and total game minutes must remain safe integers.

`advanceClock(clock, elapsedMs)` returns `{ clock, steps, alpha }`. It carries incomplete time, advances whole fixed steps, and never reads `Date`, `performance`, or timers. Elapsed time must be finite and nonnegative. Fractional milliseconds are accepted. Integer millisecond inputs give exact frame-chunk equivalence; floating point deltas have normal JavaScript rounding limits near a step boundary. For reproducible replay, use exact tick counts and record the tick at which each command is applied.

`stepClock(clock, steps = 1)` advances exact ticks, including while paused, and retains the remainder. Counts must be nonnegative safe integers. `getGameTime(clock)` returns `{ day, minuteOfDay }`, starting at day 0, minute 0. There are 1440 game minutes per day; absolute game time is `tick * minutesPerTick`.

Paused elapsed time is discarded. The remainder from before pausing is retained. Neither helper mutates its input. Invalid clock operations throw before advancing.

## Runner and commands

```ts
const simulation = new Simulation(initialWorld);
simulation.enqueue({
  type: 'citizen.relocate',
  citizenId: 'citizen-1',
  position: { x: 5, y: 7 },
});
const { state, events, steps, alpha } = simulation.advance(100);
```

| Method/property | Behavior |
| --- | --- |
| `getState()` | Current immutable snapshot; retain older snapshots safely |
| `enqueue(command)` | Copy a typed command and queue it for the next executed tick |
| `pendingCommandCount` | Number of queued commands |
| `advance(elapsedMs)` | Accumulate real time, execute fixed ticks, return one result batch |
| `step(count = 1)` | Execute exact ticks even while paused; retain accumulated time |
| `pause()` / `resume()` | Toggle clock state immediately without emitting events |

`SimulationResult` contains `state`, `events`, `steps`, and `alpha` in `[0, 1)`. Event handling is caller-owned; the engine invokes no callbacks. This keeps renderer failures or side effects outside simulation execution. There is no catch-up cap and no elapsed-time dropping while running. The frontend controls how much elapsed time it submits after a long suspension.

All pending commands are applied FIFO at the first executed tick of a batch, then removed. Duplicate commands are allowed. A zero-step advance or paused advance keeps them queued. `step(0)` also keeps them queued. A batch cannot interleave commands for later ticks; for scripted replay, enqueue before the desired tick and call `step` in suitable increments.

| Command | Effect | Rejection reason |
| --- | --- | --- |
| `citizen.relocate` | Replace one citizen's position with a point inside the plan | `citizen-not-found` or `invalid-position` |
| `citizen.set-schedule` | Replace one citizen's complete daily schedule; select the current entry on this tick | `citizen-not-found` or `invalid-schedule` |

Rejected commands emit an event and leave the affected citizen unchanged; later commands still execute. Invalid elapsed time or step counts throw and preserve both state and queued commands. Commands are typed local inputs, not an HTTP protocol.

## Events

Every event has a `type` and its simulation `tick`. Within each executed tick, order is: command results in FIFO order, activity changes in citizen array order, crossed days in ascending order, then `clock.ticked`. Array order is retained from the authored world.

| Type | Additional fields |
| --- | --- |
| `command.applied` | `commandType`, `citizenId` |
| `command.rejected` | `commandType`, `citizenId`, `reason` |
| `citizen.activity-changed` | `citizenId`, `activity`, `targetBuildingId` |
| `clock.day-started` | `day` (one event per crossed midnight) |
| `clock.ticked` | `day`, `minuteOfDay` |

The returned event array and its objects are frozen. Events are transient outputs, not an event store or a shared network contract.

## Randomness and snapshots

`createRandomState(seed)` accepts unsigned 32-bit numeric seeds or strings. Strings use FNV-1a over UTF-16 code units. `nextRandom(state)` uses Mulberry32 and returns `{ state, value }`, where `value` is in `[0, 1)`. `randomInteger(state, min, max)` returns inclusive integer values and the next state; its safe-integer bounds must be ordered and span no more than 2^32 values. The integer helper scales a 32-bit draw and is intended for basic choices, not cryptographic use or statistically exact sampling for every span.

Demo fixtures consume seeded draws for spawn offsets and retain the resulting `randomState`. Phase 0 ticks do not consume random draws. Later systems must explicitly use and retain the returned state instead of using `Math.random`.

Worlds contain plain JSON data, including clock remainders and random state. No serializer, database, migration framework, or persistence package is introduced. Pending commands live on the runner and are excluded from `WorldState`; save after draining them, or retain a separate command journal. Restoring a snapshot starts with an empty command queue.
