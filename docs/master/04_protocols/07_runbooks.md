# Protocol 7: Runbooks

| Problem | What to do |
|---|---|
| Site down | Check the PythonAnywhere Web tab (expired? click Run until 1 month). Check the error log. Check `/` and `/ops/` separately (the WSGI file serves both). |
| Sensor / gateway quiet (red Sensor alert, 10 min) | Call the site manager: power and 4G at the enclosure; check the gateway signal; check Connections page last value. |
| AI error ("could not read the photo") | Engineer types the details. Check the OpenAI key and the daily limit (100). |
| Locked out ("Too many wrong tries") | Wait 15 minutes. |
| Restore a backup | Stop writes, upload the backup `crm.db` / `ops.db` to the data folder, reload, check. Test this on a copy first. |
| Wrong data typed | Edit in the app; never edit the database by hand without a backup. |
