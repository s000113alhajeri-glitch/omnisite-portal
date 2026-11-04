# 7. R&D: scanning accuracy, markers, swarm

All numbers below are **simulations with assumed sensor errors**, not measurements. **[assumption]**

## What Chemex needs
About 10 cm is enough for the pilot (sensor positions, cable lengths). Positions come from a laser meter measured from corner A1. 1 cm is for the future product.

## Phone drift simulation (12 × 8 m hall, 52 m walk, 300 runs)
| Method | Average | 95 % below |
|---|---|---|
| Phone only | 16.1 cm | 36.2 cm |
| + end where you started | 16.8 cm | 42.4 cm |
| + 5 markers | 6.4 cm | 18.7 cm |
| + 5 markers + laser | 5.1 cm | 15.9 cm |
| Marker every 2 m + laser | 1.4 cm | 3.7 cm |

## Practical setup (no stickers left on site)
| Setup | Average | 95 % below |
|---|---|---|
| Machine labels only | 3.8 cm | 11.5 cm |
| + 4 big A3 markers on tripods | 1.6 cm | 3.9 cm |
| + corner laser shots | 1.5 cm | 3.8 cm |

## Swarm (landed beacons + 1–2 flyers), typical error per unit
| Method | 4 | 8 | 16 | 24 units |
|---|---|---|---|---|
| Radio only (10 cm) | 32.4 | 16.4 | 10.5 | 15.3 |
| Camera lights + 1 ruler | 23.2 | 4.3 | 2.0 | 1.8 |
| Radio + camera + ruler | 3.1 | 2.2 | 1.1 | 1.3 |
| Better radio (3 cm) + camera + ruler | 1.4 | 1.2 | 1.1 | 0.6 |

Design: most units land and become fixed beacons, 1–2 fly capture lanes, UWB ranging + camera-visible ID lights, one known ruler, caged propellers, machines stopped, no-fly distance 1.5 m. Not built or tested.

## Phone-only scanning
Needs a native iPhone app (Apple RoomPlan) on an iPhone Pro with LiDAR. Safari can't use LiDAR. Apple publishes no cm accuracy figure. Pending: her iPhone model (13 or 13 Pro).

## Pros' tools
NavVis lists 4–8 mm (LX series, official page). Leica BLK2GO / FARO Orbis not verified.
