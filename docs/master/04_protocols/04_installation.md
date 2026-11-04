# Protocol 4: Installation (engineer)

Source: CRM `INSTALL_PLAN`; stages lock in order; each check is Pass / Fail with evidence; Fail needs a note. **[verified]**

## Stage 1: Receive and verify assets
Check every item against the quotation.

| # | Check | Pass when | Evidence |
|---|---|---|---|
| 1.1 | PT100 probe, RS PRO 872-2727 | Model matches; probe and cable undamaged | Photo of label + item |
| 1.2 | PT100 → 4–20 mA transmitter, RS PRO 872-2758 | Model matches | Photo of label |
| 1.3 | Advantech ADAM-4117 | Model matches | Photo of label + Serial no. |
| 1.4 | Teltonika TRB246 gateway + antennas + SIM | Model matches; SIM active | Photo of label + Serial no. |
| 1.5 | Mean Well HDR-60-24 power supply | Model matches | Photo of label |
| 1.6 | Enclosure IP66 (Fibox ARCA 303021) | Undamaged, glands included | Photo |
| 1.7 | Eagle ECON PLT-600-L scale, RS-232 | Model matches; RS-232 port present | Photo of label + port + Serial no. |
| 1.8 | Smart TV 50" + wall bracket | Powers on; browser opens | Photo |
| 1.9 | Operator/QC tablet (Galaxy Tab A9+ 5G) + SIM | Powers on; SIM active | Photo + IMEI |
| 1.10 | Manager iPad Cellular + SIM | Powers on; SIM active | Photo + Serial no. |
| 1.11 | RS-485 cable, RS-232 cable, terminals, fuse | Enough length for the measured route | Photo |

## Stage 2: Confirm everything can connect
Site checks, then a bench test before installing.

| # | Check | Pass when | Evidence |
|---|---|---|---|
| 2.1 | Mixer motor runs through the Schneider Altivar 212 drive | Drive label confirms ATV212 | Photo of drive label |
| 2.2 | Drive Modbus screw terminals (D1/B, D0/A, common) are free | Nothing already connected | Photo of terminals |
| 2.3 | Electrical panel is safe to work in (survey: panels are old) | Chemex maintenance agrees |  + Name of person who approved |
| 2.4 | Chemex approves changing the drive's Modbus settings | Written OK from Chemex maintenance | Message or signed note |
| 2.5 | Tank depth and manway route for the probe | Probe can be fixed clear of the mixer blades | Photo + Depth measured |
| 2.6 | Heaviest item weighed | 600 kg or less |  + Heaviest item (kg) |
| 2.7 | Distance from the scale spot to the enclosure spot | 15 m or less (RS-232 limit) |  + Distance measured (m) |
| 2.8 | 4G signal at the enclosure spot | Gateway shows a usable signal | Screenshot of signal |
| 2.9 | 230 V power near the enclosure and the TV | Power point available | Photo |
| 2.10 | Internet for the TV (factory Wi-Fi or tablet hotspot) | TV opens a web page | Photo |
| 2.11 | Bench test: gateway reads the ADAM-4117 over RS-485 (Modbus) | Value changes when the probe is warmed by hand | Screenshot of gateway reading |
| 2.12 | Bench test: gateway reads the new scale over RS-232 | Known test weight shows the same kg on the gateway | Screenshot + photo of scale display |
| 2.13 | Bench test: gateway sends data to OmniSite (address given by OmniSite) | Test value appears on the OmniSite dashboard | Screenshot of dashboard |

## Stage 3: Installation
During a planned stop, with the drive switched off and locked.

| # | Check | Pass when | Evidence |
|---|---|---|---|
| 3.1 | Planned stop agreed with Chemex; drive isolated (lock-out/tag-out) | Drive off and locked | Photo of lock/tag |
| 3.2 | Enclosure mounted away from wash-down; power supply, fuse, gateway, ADAM, transmitter fitted | Fixed and closed; glands sealed | Photo inside + outside |
| 3.3 | RS-485: gateway → drive terminals → ADAM; drive termination switch on at the end of the line | Shielded cable, shield earthed one end | Photo of wiring |
| 3.4 | Drive Modbus settings set (address, speed); record old and new values | Settings recorded | Photo of before/after settings |
| 3.5 | PT100 probe through the manway, clamped clear of the blades; cable routed safely | Probe fixed; no contact with blades | Photo |
| 3.6 | New scale placed next to the existing scale; RS-232 cable to the gateway | Scale level; cable protected from water | Photo |
| 3.7 | TV mounted; OmniSite display page opened | Page shows mixer status | Photo |
| 3.8 | Operator/QC tablet and manager iPad logged in to OmniSite | Both open the right screen | Screenshot of each |
| 3.9 | Drive switched back on; mixer runs normally | Mixer runs as before install | Video, 10–20 s |

## Stage 4: Testing on site
Each test must show on the dashboard.

| # | Check | Pass when | Evidence |
|---|---|---|---|
| 4.1 | Start the mixer | Dashboard shows "working" within about 1–2 minutes | Video or screenshot with time |
| 4.2 | Stop the mixer | Dashboard shows "stopped" and counts stop minutes | Screenshot |
| 4.3 | Temperature | Reading within ±2 °C of a reference thermometer in the tank | Photo of both readings |
| 4.4 | Scale | Known test weight shows the same kg on the dashboard | Photo + screenshot |
| 4.5 | QC enters pH and viscosity on the tablet | Values show on the manager iPad and the display | Screenshots |
| 4.6 | Operator taps "Moved to holding tank" | Batch ID created and batch shows as done | Screenshot |
| 4.7 | Unplug the gateway antenna or SIM for 5 minutes | Dashboard shows "not sending data"; recovers after reconnecting | Screenshots |
| 4.8 | Run 1 full batch end to end | All values recorded in the batch record | Screenshot of batch record |
| 4.9 | Leave running 24 hours | No unexplained data gaps | Screenshot of 24 h data |

Before the stages: select the machine, then scan its label (must match). Scan each asset QR; wrong machine / factory is refused. A fitting photo is required before Send for review.
