# Social activities

Phase 7's society decides who goes out, where, with whom and when. The Character View shows the result. It never invents a crowd.

- **Venue visitors.** A resident is drawn at a venue only while their outing to it is `present` (or, for Phase 3 leisure, while they are inside that park, pool or clubhouse).
  - The spot and action come from `crowdLayout(world, frontOf)`, the City View's `venueCrowd` profiles: café terraces and market stalls (sit and talk), plazas and parks (idle and talk), companions placed together.
  - Indoor venues (cinema, nightclub, shops, mall interiors) keep visitors inside, counted in `hidden.inside`.
- **Events.** During a running event its attendees use the event action. At the stage concert they face the stage and cheer.
  - The unit test `livingWorld.test.ts` checks the Friday 20:50 concert: every resident drawn at the stage has a `present` outing to it, is listed in the event's `attendees`, and cheers. The concert screenshot (09) shows 49 venue figures, all real attendees or visitors.
- **Calendar.** The weekly `CITY_CALENDAR` drives what happens. On Friday evening the Lantern Night Market festival and the Bayside Stage concert fill up (screenshots 08, 09). On weekday evenings cafés fill after work (07: 38 visitors drawn at venues near Dune Café at 19:45).
- **Interacting.** A venue inspected with E shows its live visitors, hours and events (`venueView`). Visit and Eat here are the Life Mode commands, refused with the simulation's own reason when closed (`venue-closed`).
- **Mingling.** Greeting and chatting happen only through Life commands. Inspecting a resident never changes a relationship.
