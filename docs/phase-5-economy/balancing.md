# Balancing (Phase 5)

All constants live in `packages/simulation/src/economyConfig.ts` (`ECONOMY`), typed and frozen. The game uses no other
money numbers.

## Scale

Money uses the existing dollar scale:
- **Construction:** villa $120, apartment $480, office $640, mall $900, road $8.
- **Starting funds:** $24,680 for the sample city, $5,000–$20,000 for test cities.
- **Time:** one game day lasts 144 s at 1× and 36 s at 4×.

The targets were:
- A balanced town roughly pays its way.
- A mature mixed town earns a modest surplus: an office's construction cost every two or three days, not every hour.
- A town without jobs, or with too many amenities, loses money slowly enough to recover.

## Reference cities (ten days of the real simulation)

From `node scripts/p5_balance.mjs` (the six `economyBalance.test.ts` cities), at default taxes unless stated.

| City | Residents | Employed / jobs | Income per day | Expenses per day | Net per day | Businesses profitable | Notes |
|---|---|---|---|---|---|---|---|
| A. Small residential town (10 villas, park) | 20 | 0 / 0 | $0 | $259 (support $100, roads $89, services $60, park $10) | −$259 | — | savings drain to $43 per resident |
| B. Growing balanced (3 apartments, 6 villas, office, mall, park) | 84 | 84 / 160 | $408 (residential $199, commercial $209) | $351 | +$57 | 2/2 | 81% of shopping stays local |
| C. Commercial-heavy (2 apartments, 3 malls, 2 offices) | 48 | 48 / 420 | $246 | $233 | +$13 | 1/5 | four empty businesses lose their operating costs |
| D. High maintenance (2 apartments, office, 4 pools, 3 clubhouses, 4 parks) | 48 | 48 / 60 | $299 (incl. fees $53) | $423 (amenities $190) | −$124 | 1/1 | amenity coverage 100%, confidence 108% |
| E. Unemployed residential (6 apartments, 4 villas, park) | 152 | 0 / 0 | $0 | $1,315 (support $760) | −$1,315 | — | about 15 days to an empty treasury from $20,000 |
| F. Mature mixed (10 apartments, 8 villas, 4 offices, 2 malls, 3 parks, pool, clubhouse) | 256 | 256 / 440 | $1,295 | $929 | +$366 | 5/6 | $3,331 of $3,971 shopping goes outside: a `shopping-demand` alert asks for a staffed mall |
| F at 14% commercial tax | 256 | 256 / 440 | $1,703 | $929 | +$774 | 1/6 | offices now lose money |
| F at 20% / 20% | 256 | 256 / 440 | $2,322 | $929 | +$1,393 | 0/6 | confidence 88%; every business reports losses |

What this shows:
- **Jobs decide everything.** A resident costs the city $3 a day for services, plus $5 if unemployed. An employed
  resident pays about $2–3 in residential tax, and their workplace pays commercial tax. The surplus comes from staffed
  businesses.
- **No effortless wealth at default rates.** B earns about $57 a day. F's surplus is about 57% of an office's
  construction cost per day.
- **No unavoidable bankruptcy.** Even E has about 15 days of runway, and one office turns 60 of its residents from
  costing $8 to paying their way.
- **No permanently profitable empty businesses.** An unstaffed business has no revenue and a full operating loss
  (scenario C).
- **No infinite demand.**
  - Shopping is bounded by income and savings.
  - Local sales are bounded by mall staff.
  - Office revenue is bounded by staff and by demand at the commercial tax rate.
- **No unlimited employment.** Workers come only from real job slots.
- **No hidden penalties.** Every cost has a ledger category and a dashboard row. Unpaid costs are listed and announced.

## Trade-offs the player meets

- **Build jobs before homes, or homes before jobs:** unemployment support versus empty-office losses.
- **Malls versus shopping outside the city:** a mall needs about 200 local shoppers.
- **Amenities:** cost upkeep, earn fees from real visits, and raise confidence (up to +8%).
- **Taxes:**
  - Raising them brings money now.
  - Residents shop less (confidence −2% per point above 10%), and more shopping leaves the city.
  - Office clients leave (−4% per point above 6%), so businesses lose money.
  - Commercial income peaks around 14% and falls by 20%.

## Known balance limitations

- Maximum taxes still raise net city income (F: +$1,393 instead of +$366), because Phase 5 consequences are
  informative:
  - Business losses are covered by owners outside the city, and nothing closes.
  - Lower confidence reduces shopping, not population.

  The cost is visible (0/6 businesses profitable, six loss alerts, confidence 88%) but not yet structural. Business
  closures and relocation, demand-driven arrivals, and hiring by demand are documented next steps. They would turn
  these signals into consequences.
- Housing still fills instantly when built (existing population rule), so population growth is not yet a demand
  response.
- There are no difficulty settings: one documented balance.
