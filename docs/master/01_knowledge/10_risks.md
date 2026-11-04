# 10. Risk register

| Risk | Impact | Action |
|---|---|---|
| Chemex not confirmed | No pilot | Low-disruption offer, free survey, 2 free weeks |
| Free hosting expires monthly | Site goes down | Click "Run until 1 month from today" on PythonAnywhere, or move to the USD 10/month plan |
| One PythonAnywhere token for everything | Could delete live data | Rotate it, keep it only in the secret store, offsite backups |
| No offsite backups yet | Data loss | Daily backup to a private repo + restore test |
| Live code newer than GitHub | Lost work, overwrites | Put live code in a private repo, deploy from it |
| Old Chemex panels | Safety | Maintenance approval before any wiring |
| Altivar 212 discontinued | Spare parts | Read-only Modbus, no changes to the drive |
| Probe too short / no nozzle | No temperature | Check depth and manway route on site |
| AI misreads a nameplate | Wrong data | Engineer always confirms; unreadable fields stay empty |
| Phone scan accuracy | Wrong positions | Laser meter from A1 for Chemex |
