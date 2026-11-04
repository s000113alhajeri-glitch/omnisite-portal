# 3. Chemex (first pilot factory)

**Status:** first prospect, not yet confirmed. Concerns: disruption to operations and cost. **[verified]**

## Site facts **[verified: client, 2026-10-20 + survey reports]**
- Industrial area, not hazardous. 4G available at the mixer. A PC is next to the Brookfield viscometer.
- Alerts to the manager via WhatsApp (wished). Bleach is a separate line; the mixer is for detergent.
- Process (P&ID, hand-drawn, confidential): mixing tank (motor agitator, sight glass only) → pneumatic pump / recirculation → holding tank → 8-nozzle filler. 12-step process; the mixer MVP covers steps 4–7.
- Preliminary Site Survey Report (7 pages): the existing scale "is not suitable for automatic data integration" (weights on paper); agitators are Schneider Altivar 212, 4 kW / 5 HP; existing panels are "old and not recommended for reuse".
- The Chemex roadmap (Vasist, Jul 2026) and the Margaflow quotation scope a full PLC / SCADA automation project. Keep it separate from OmniSite's read-only pilot.

## Machine list (from Chemex, 15 items) **[verified: Chemex list]**
| # | Item | Brand | Model |
|---|---|---|---|
| 1 | Mixing tank motor | Brook Crompton Huddersfield UK | B-DA112MA-D |
| 2 | 8 nozzle filling machine | KWT Machine System Co | KWT-880R |
| 3 | 8 nozzle date coding printer | Linx Printer | 8910IP55 |
| 4 | 8 nozzle labelling machine | KWT Machine System Co | KWT-620D-R |
| 5 | 4 nozzle filling machine | KWT Machine System Co | KWT-840R |
| 6 | 4 nozzle date coding printer | Linx Printer | 8910IP55 |
| 7 | 4 nozzle labelling machine | KWT Machine System Co | KWT-620D |
| 8 | Bleach machine motor | Taidel Pump | MKK-P441-2CSSE |
| 9 | Bleach filling machine | Ideas Packaging Machinery | SIM-4N-CXFS-92 |
| 10 | Bleach labelling machine | KWT Machine System Co | KWT-515C |
| 11 | Bleach machine date coding printer | Linx Printer | 8910IP55 |
| 12 | Air compressor | Power King Pump | LB-40A |
| 13 | Viscometer | Brookfield | DV2TRVTJO |
| 14 | pH / ORP meter | Hanna | HI2211 |
| 15 | Weighing balance | Adler | ASI101P-1T |

All 15 are in the live CRM for Chemex (13 as Machine, 2 as Tool). Ratings, positions and photos come from the survey.

## What can connect (makers' docs) **[verified]**
| Equipment | Data path | Stage |
|---|---|---|
| Altivar 212 drive | Modbus RTU screw terminals: speed, current, kWh, faults (drive discontinued 8 Jun 2026) | 1 |
| Brookfield DV2T | USB to PC (RheocalcT / DV360) | 1 |
| Linx 8910 | Ethernet RCI / SCP | 1 |
| KWT-880R | Mitsubishi PLC | 1–2 |
| Hanna HI2211 | No PC port: pH typed manually | 3 |
| Adler ASI-101P | Serial port per distributor brochure, not on maker page: confirm on site | ? |

## Pilot hardware (mixer) **[decision / assumption: final quote pending]**
PT100 probe (RS PRO 872-2727, only 300 mm long: check it reaches the liquid) + 4–20 mA transmitter (RS PRO 872-2758) → Advantech ADAM-4117 (or ADAM-4015) → Teltonika TRB246 4G gateway (RS-485 + RS-232 + Ethernet, no Wi-Fi) → OmniSite. Mean Well HDR-60-24 PSU, Fibox ARCA IP66 enclosure. New connected scale: Eagle ECON PLT-600-L (600 kg × 100 g, RS-232, ≈ AED 1,250) placed next to the existing one. People: display-only smart TV (replaces the whiteboard), manager iPad with SIM, operator / QC tablet with SIM. No screen at the tank.

## Open site checks
Probe entry (no spare nozzle on the P&ID), drive Modbus settings approval (read-only), panel safety, scale ≤ 15 m from the gateway (RS-232), 600 kg enough, Wi-Fi or hotspot for the TV.
