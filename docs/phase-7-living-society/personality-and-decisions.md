# Personality and decisions

## Personality

Every resident has five traits (0–100) and two interests. All are generated **once**, when the resident first appears in a society, and then stored in their profile, so later formula changes never alter an existing resident. Each trait is the mean of two FNV-1a hashes of the resident's ID and name, which clusters values around the middle (10–90) and makes extremes rarer.

Traits never use age or any demographic attribute. Names are drawn at random by the world RNG and serve only as a hash salt, so traits do not correlate with anything about the person.

| Trait | High | Low | What it changes |
|---|---|---|---|
| Sociability | Outgoing | Reserved | +0.3 per point above 50 for social venues; +0.2 per point below 50 for quiet ones (park, cinema). How many friends they invite (1 if 40–44, 2 if 45–69, 3 if 70+). Staying in gains +8 when below 35. |
| Curiosity | Curious | Creature of habit | New venues (not among the last 4 visited) gain 0.15 × curiosity. Recent ones gain 0.2 per point below 50, so the less curious keep their favourites. |
| Vitality | Night owl | Early to bed | The music club gains 0.3 per point above 50. At 60+, work nights may run to 01:00. |
| Frugality | Thrifty | Free-spending | Price cost per dollar is (30 + frugality) / 40. Free activities gain up to +10 for the thrifty. Cash kept untouched is 15 + 0.4 × frugality dollars. |
| Community | Community-minded | Private | City events gain 0.3 per point above 50. |

The nine interests are food, shopping, film, music, nightlife, outdoors, arts, thrills and fitness. Each resident's two are their top two in a per-resident hash ranking. An activity that matches one of their interests gains +20 per match. Each venue lists its interests (for example cinema → film, night market → food and shopping), and each event kind lists its own.

## Needs

Each resident has four needs (0–100, where 100 is satisfied), on the same scale and with the same meaning as the Life Mode player's: energy, hunger, social, and fun (leisure satisfaction). Overall *wellbeing* is their mean; it is shown and not stored.

Needs update once per 15 minutes, by what the resident is doing:

| Doing | Energy | Hunger | Social | Fun |
|---|---|---|---|---|
| Sleeping | +7 | −1 | 0 | 0 |
| At home (meals at home) | +1 | +4 | −2 | 0 |
| Working | −1 | −1 | +1 | −1 |
| Travelling | −1 | −1 | 0 | 0 |
| At a venue | −1 −1 + venue effect | | | |

Each venue adds its own effect. For example, a café restores +22 hunger and the amusement park +10 fun at −3 energy. Being there with other people adds +2 social, and a matching interest adds +2 fun.

Hosting a friend at home adds +8 social and +3 fun. Chatting with the Life Mode player adds +6 social and +1 fun.

The result is a recognisable rhythm. A working day leaves people somewhat hungry, tired and short of fun. Evenings at home drain company. A weekend at home drains company further, so weekends draw people out.

## Decisions

**When.** A resident considers going out on their 15-minute slot if all of these hold:

- no outing is planned and they are not hosting;
- the cool-down has passed: 45 minutes after an outing ends, or 60 minutes after deciding to stay in;
- they are inside their home, or at their workplace once their shift has ended (so "after work" means straight from work);
- the schedule gives them free time (not sleep, not work);
- they have not reached today's limit (2 outings on a working day, 3 on a day off).

**The window.** This is the time until they must head home:

- before work tomorrow, with 60 minutes' buffer;
- or the latest night out: midnight on work nights, 01:00 for night owls, 02:30 before a day off.

Each option's travel, plus its duration, plus travel home must fit the window.

**Options** are:

- the nearest 3 venues of every type: open on arrival, or opening within two hours (they leave in time to arrive at opening); for the cinema, a screening that starts within three hours;
- scheduled or running events: they arrive by the start, or join a running event with at least 45 minutes left;
- friends' homes: up to 3 friends with strength ≥ 40 who are at home, free, awake and not hosting anyone.

An option is dropped if any of these hold:

- no road connects the two places;
- travel takes more than 90 minutes;
- the price exceeds the money they can spend;
- the venue is full. A full favourite is recorded as unmet demand ("turned away").

**Utility** is an integer sum of explained factors:

| Factor | Points |
|---|---|
| base | 10 |
| appeal | venue appeal: amusement 22, cinema 18, club 14, shops 12, market 8, café 6, pool and clubhouse 4, park and plaza 2 |
| bored | 0.4 × (100 − fun) |
| hungry | 0.6 × (100 − hunger), for places that serve food |
| lonely | 0.5 × (100 − social) for social places, 0.2 for quiet ones, 0.7 for a friend's home |
| interest | +20 per matching interest |
| sociable / quiet | traits, as above |
| event | event appeal (concert 30, festival 18, movie night 16, performance 14) plus community |
| night owl | vitality, for the club |
| new place / favourite | curiosity, as above |
| price | −price × (30 + frugality) / 40, and −2 × price if it would use more than a third of their spendable money |
| free | +6 + (frugality − 50) / 10 for free activities when thrifty or short of money |
| travel | −0.45 per minute; nearby (≤ 15 min) +4 |
| tired | −(40 − energy) for the club, rides and shopping when energy < 40 |
| again | −15 for repeating the same activity on the same day |
| friend | +6 for each joinable friend (up to 2); for a home visit, 0.3 × the friendship |

**Staying in** scores:

30 + 0.5 × (100 − energy) + 15 per outing already today + (frugality − 50) / 10 + 8 for homebodies (sociability below 35).

The resident picks the best option that beats staying in and has room. Options within 6 points of the best count as similarly good, and a stable hash of the resident and tick chooses among them. That is the only use of seeded variety, and it never overrides a clearly better choice.

**Group outings.** For a social venue, an initiator with sociability ≥ 40 (or social need below 40) invites up to their limit of friends with strength ≥ 25. A friend joins only if all of these hold:

- they are free where they are and rested (energy ≥ 25);
- the outing fits their own window and their money;
- their own utility for it (including the company) is at least their stay-in value − 5.

Companions share the outing's ID and each travels from where they are.

**Explanations.** Every decision stores its top three positive factors as codes, for example `hungry`, `interest:food`, `friend:npc-12`, `event:event-7`, `nearby`. Staying in stores its reasons: `tired`, `been-out`, `saving`, `homebody`, `nothing-open`. The resident profile shows them as phrases ("Hungry · Loves food · With Mai 12"). `explainDecision(world, navigator, citizenId)` returns every option with its full factor list, for debugging.

## Daily and weekly routines

- Day 0 is a Monday and days 5–6 are the weekend; there is no real-world calendar.
- On days off, scheduled work becomes free time.
- The old fixed 17:00–19:00 leisure block is free time at home until the resident decides otherwise.
- Bed time is the schedule's, unless an outing runs later (night owls and days off).
- Variety comes from personal schedule offsets (±20 min), staggered decision slots, personal outing lengths and real differences in needs, traits, money, friends and travel time. Residents therefore never all leave at once.
- Work stays meaningful: no outing ends later than 60 minutes before the next shift. A browser test checks that every employed resident is at work mid-morning on a weekday.

In a measured week of the 56-resident test town, weekday outings were about 30–40 a day and Saturday's about 90–100. Weekdays favour meals out and the night market, while weekends spread across parks, the plaza, the pool, shopping, events and friends' homes.
