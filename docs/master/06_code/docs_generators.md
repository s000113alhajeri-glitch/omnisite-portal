# Document generators

Scripts that build the checklist files.

## `checklist.py`

```python
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

d = Document()
s = d.sections[0]
s.left_margin = s.right_margin = Cm(1.8)
st = d.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(10)
h = s.header.paragraphs[0]; h.text = "OmniSite"; h.runs[0].bold = True; h.runs[0].font.size = Pt(14)
f = s.footer.paragraphs[0]; f.text = "OmniSite · Internal progress checklist · Confidential"; f.alignment = WD_ALIGN_PARAGRAPH.CENTER; f.runs[0].font.size = Pt(8)

def shade(cell, hexc):
    tcPr = cell._tc.get_or_add_tcPr(); sh = OxmlElement('w:shd')
    sh.set(qn('w:val'), 'clear'); sh.set(qn('w:color'), 'auto'); sh.set(qn('w:fill'), hexc); tcPr.append(sh)

COL = {"Done": "D9F2DC", "To confirm": "FFF1C2", "To do": "F2F2F2"}

def table(rows, head):
    t = d.add_table(rows=1, cols=len(head)); t.style = 'Table Grid'
    for i, x in enumerate(head):
        c = t.rows[0].cells[i]; c.text = x; c.paragraphs[0].runs[0].bold = True; shade(c, "1F1F1F")
        c.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
    for r in rows:
        cells = t.add_row().cells
        for i, x in enumerate(r):
            cells[i].text = x
        shade(cells[2], COL[r[2]])
    for row in t.rows:
        for i, w in enumerate([Cm(0.9), Cm(7.5), Cm(2.2), Cm(7.2)]):
            row.cells[i].width = w

d.add_heading("OmniSite: progress checklist", 1)
d.add_paragraph("Status: Done = finished · To confirm = partly done or not confirmed yet · To do = not started")

d.add_heading("Part A: Done so far", 2)
table([
 ("1", "Market analysis and feasibility study", "Done", "Arabic feasibility study, UAE SME factory market, MoIAT / Hi2 research"),
 ("2", "Problem validation", "Done", "Chemex + 3 experts. This proves the problem, not that customers will pay yet"),
 ("3", "Service model and offer", "Done", "Audit first. Stage 0 survey → 1 connect what exists → 2 add IoT → 3 replace machines"),
 ("4", "Financials", "Done", "Price list, Chemex pilot quotation, monthly cost and profit per factory"),
 ("5", "Internal CRM (live)", "Done", "12-stage pipeline, engineer jobs, assets with QR, purchases, support"),
 ("6", "Owner and manager dashboards (live, /ops/)", "Done", "Mixer status, batches, QC, view-only owner, Request support, demo factory"),
 ("7", "Dashboard ready for sensors", "Done", "Gateway connection + sensor alerts built. Not connected to Chemex yet"),
 ("8", "Chemex preliminary site survey + P&ID mapped", "Done", "Altivar 212 drives found, 2 mixing tanks, scale not connectable"),
 ("9", "Pilot hardware plan + engineer handover pack", "Done", "Checked against makers' documents. Final checks happen on site"),
 ("10", "Joined Hi2 incubator", "Done", "OmniSite licence will go through Hi2"),
 ("11", "Contract drafts", "To confirm", "NDA, pilot agreement, dev & IP agreement drafted. MOU needs fixes. No lawyer review yet"),
], ["#", "Item", "Status", "Note"])

d.add_heading("Part B: Remaining: real execution with Chemex (in order)", 2)
table([
 ("1", "Set up the company (licence through Hi2, trade name, bank account)", "To confirm", "Contracts must be signed in the company's name. UBO filing within 60 days, Corporate Tax registration within 3 months"),
 ("2", "Lawyer review of NDA, pilot agreement and MOU", "To do", "Fix MOU: real pilot duration, remove % savings promises, no fixed PLC brand, correct party names"),
 ("3", "Decide pilot length", "To do", "Pilot draft says 4 months, quotation says minimum 3 months. Pick one"),
 ("4", "On-site operational audit + baseline report", "To confirm", "Your 8 audit points, 5 baseline areas. Agree the top pain point with Chemex"),
 ("5", "Sign NDA with Chemex", "To do", "Your CRM order: after the audit"),
 ("6", "Agree scope of work + who does what", "To do", "Chemex QC keeps pass/reject. OmniSite never controls machines"),
 ("7", "Send pilot proposal + quotation and get approval", "To do", "Setup fee, Chemex buys equipment + installation, AED 3,000/month after 2 free weeks"),
 ("8", "Sign pilot agreement", "To do", "Moves Chemex to 'Agreement signed' in the CRM"),
 ("9", "Confirm the implementation engineer", "To do", "Get the engineer's quote for labour and visits"),
 ("10", "Final site checks by the engineer", "To do", "Motor nameplate, probe entry through manway, drive comm settings (maintenance approval), short stop for wiring, panel safety, scale distance"),
 ("11", "Buy hardware (Chemex) + SIMs, iPad, tablet, TV", "To do", "Register every item in CRM Assets with QR labels"),
 ("12", "Bench test gateway + sensors before going to site", "To do", "CRM installation job, stage 2"),
 ("13", "Install and commission at Chemex", "To do", "CRM installation job stages 3 to 6, with evidence and approval form"),
 ("14", "Set up Chemex in /ops/", "To do", "Manager/owner logins, targets and prices from the audit, connect gateway key"),
 ("15", "2-week recording (baseline)", "To do", "Free period. No limits set yet"),
 ("16", "Agree QC limits with Chemex QC", "To do", "Based on the 2-week data, not guessed"),
 ("17", "Monthly service starts", "To do", "AED 3,000/month, minimum period as agreed"),
 ("18", "Results report + case study", "To do", "Measured results only. Use it for Hi2, mentor and next factories"),
 ("19", "Upgrade hosting before go-live", "To do", "Free PythonAnywhere plan expires monthly and has no own domain"),
], ["#", "Step", "Status", "Note"])

d.save("/home/ubuntu/omni_docs/OmniSite_Progress_Checklist.docx")

```

## `checklist_xlsx.py`

```python
import datetime as dt
import xlsxwriter, math
def rh(*texts_widths):
    return max(15, 15 * max(math.ceil(len(t) / (w * 1.15)) for t, w in texts_widths))

wb = xlsxwriter.Workbook("/home/ubuntu/omni_docs/OmniSite_Progress_Checklist.xlsx")
ws = wb.add_worksheet("Checklist")
F = "Calibri"
title = wb.add_format({"bold": True, "font_size": 16, "font_name": F})
sub = wb.add_format({"italic": True, "font_color": "#666666", "font_name": F})
lbl = wb.add_format({"bold": True, "font_name": F, "align": "right"})
startf = wb.add_format({"num_format": "dd mmm yyyy", "bg_color": "#FFF1C2", "border": 1, "bold": True, "font_name": F, "align": "center"})
pct_big = wb.add_format({"num_format": "0%", "bold": True, "font_size": 14, "font_name": F, "align": "center", "border": 1})
sect = wb.add_format({"bold": True, "font_size": 12, "bg_color": "#1F1F1F", "font_color": "#FFFFFF", "font_name": F})
head = wb.add_format({"bold": True, "bg_color": "#E8E6F8", "border": 1, "font_name": F, "valign": "vcenter", "text_wrap": True, "align": "center"})
headl = wb.add_format({"bold": True, "bg_color": "#E8E6F8", "border": 1, "font_name": F, "valign": "vcenter"})
txt = wb.add_format({"border": 1, "text_wrap": True, "valign": "vcenter", "font_name": F})
num = wb.add_format({"border": 1, "align": "center", "valign": "vcenter", "font_name": F})
chk = wb.add_format({"border": 1, "align": "center", "valign": "vcenter"})
datef = wb.add_format({"border": 1, "num_format": "dd mmm yyyy", "align": "center", "valign": "vcenter", "font_name": F})
pctf = wb.add_format({"num_format": "0%", "border": 1, "align": "center", "bold": True, "font_name": F, "valign": "vcenter"})
green = wb.add_format({"bg_color": "#D9F2DC", "font_color": "#1E6B2A", "bold": True})
red = wb.add_format({"bg_color": "#FBD5D5", "font_color": "#A11B1B", "bold": True})
amber = wb.add_format({"bg_color": "#FFF1C2", "font_color": "#7A5A00"})

# Columns: A #, B Task, C Done, D Week, E Deadline, F Status, G Remark
for c, w in zip("ABCDEFG", [5, 52, 8, 8, 14, 12, 70]):
    ws.set_column(f"{c}:{c}", w)

ws.write("A1", "OmniSite: progress checklist", title)
ws.write("A2", "Tick the box when a task is done. Progress, status and overdue warnings update automatically.", sub)
ws.write("B4", "Execution start date (Monday of week 1):", lbl)
START = dt.datetime(2026, 10, 26)
ws.merge_range("C4:D4", None, startf)
ws.write_datetime("C4", START, startf)
ws.write("F4", "Change this date and every proposed deadline moves with it", sub)
ws.write("B5", "Overall progress:", lbl)

done_A = [
 ("Market analysis + feasibility study", "Arabic feasibility study, UAE SME factory market, MoIAT / Hi2 research"),
 ("Problem validation", "Chemex + 3 experts. Proves the problem, not willingness to pay yet"),
 ("Service model and offer", "Audit first. Stage 0 survey → 1 connect what exists → 2 add IoT → 3 replace machines"),
 ("Financials", "Price list, Chemex pilot quotation, monthly cost and profit per factory"),
 ("Internal CRM (live)", "12-stage pipeline, engineer jobs, assets with QR, purchases, support"),
 ("Owner + manager dashboards (live, /ops/)", "Mixer status, batches, QC, view-only owner, Request support, demo factory"),
 ("Dashboard ready for sensors", "Gateway connection + sensor alerts built. Not connected to Chemex yet"),
 ("Chemex preliminary site survey + P&ID mapped", "Altivar 212 drives found, 2 mixing tanks, existing scale not connectable"),
 ("Pilot hardware plan + engineer handover pack", "Checked against makers' documents. Final checks happen on site"),
 ("Joined Hi2 incubator", "OmniSite licence will go through Hi2"),
]
todo_A = [("Contract drafts reviewed and final", "To confirm: NDA, pilot agreement, dev & IP drafted. MOU needs fixes. No lawyer review yet")]

B = [
 ("Company licence via Hi2 + trade name + bank account", 2, "To confirm. Contracts must be signed in the company's name. UBO filing within 60 days, Corporate Tax registration within 3 months"),
 ("Decide pilot length", 1, "Pilot draft says 4 months, quotation says minimum 3 months. Pick one"),
 ("Lawyer review of NDA, pilot agreement and MOU", 2, "Fix MOU: real pilot duration, remove % savings promises, no fixed PLC brand, correct party names"),
 ("On-site operational audit + baseline report + top pain point agreed", 3, "To confirm. 8 audit points, 5 baseline areas"),
 ("Sign NDA with Chemex", 3, "CRM order: after the audit"),
 ("Confirm implementation engineer + get labour quote", 4, "Needed for the final quotation"),
 ("Agree scope of work + who does what", 4, "Chemex QC keeps pass/reject. OmniSite never controls machines"),
 ("Send pilot proposal + quotation, get approval", 4, "Setup fee, Chemex buys equipment + installation, AED 3,000/month after 2 free weeks"),
 ("Sign pilot agreement", 5, "Move Chemex to 'Agreement signed' in the CRM"),
 ("Final site checks by the engineer", 5, "Motor nameplate, probe entry via manway, drive comm settings (maintenance approval), short stop for wiring, panel safety, scale distance"),
 ("Buy hardware (Chemex) + SIMs, iPad, tablet, TV", 7, "Some parts ship in 10–12 days. Register every item in CRM Assets with QR labels"),
 ("Upgrade hosting before go-live", 8, "Free PythonAnywhere plan expires monthly and has no own domain"),
 ("Bench test gateway + sensors before going to site", 8, "CRM installation job, stage 2"),
 ("Install and commission at Chemex", 9, "CRM installation job stages 3–6, with evidence and approval form"),
 ("Set up Chemex in /ops/", 9, "Manager/owner logins, targets and prices from the audit, connect gateway key"),
 ("2-week recording (baseline)", 11, "Free period. No limits set yet"),
 ("Agree QC limits with Chemex QC", 12, "Based on the 2-week data, not guessed"),
 ("Monthly service starts", 12, "AED 3,000/month, minimum period as agreed"),
 ("Results report + case study", 13, "Measured results only. Use for Hi2, mentor and next factories"),
]

def headers(r, wk_label):
    for c, h in enumerate(["#", "Task", "Done", wk_label, "Deadline", "Status", "Remark"]):
        ws.write(r, c, h, headl if c in (1, 6) else head)
    ws.set_row(r, 22)

def status_cf(r1, r2):
    rng = f"F{r1}:F{r2}"
    ws.conditional_format(rng, {"type": "cell", "criteria": "==", "value": '"Done"', "format": green})
    ws.conditional_format(rng, {"type": "cell", "criteria": "==", "value": '"Overdue"', "format": red})
    ws.conditional_format(rng, {"type": "cell", "criteria": "==", "value": '"Open"', "format": amber})

r = 6  # 0-based row 6 = Excel row 7
ws.merge_range(r, 0, r, 6, "Part A: Done so far", sect); r += 1
headers(r, "Week"); r += 1
a1 = r + 1
items = [(t, True, m) for t, m in done_A] + [(t, False, m) for t, m in todo_A]
for i, (t, d, m) in enumerate(items, 1):
    x = r + 1
    ws.write(r, 0, i, num); ws.write(r, 1, t, txt); ws.insert_checkbox(r, 2, d, chk)
    ws.write(r, 3, "", num); ws.write(r, 4, "", datef)
    ws.write_formula(r, 5, f'=IF(C{x},"Done",IF(AND(ISNUMBER(E{x}),E{x}<TODAY()),"Overdue","Open"))', num, "Done" if d else "Open")
    ws.set_row(r, rh((m, 70), (t, 52)))
    ws.write(r, 6, m, txt); r += 1
a2 = r
status_cf(a1, a2)
ws.write(r, 4, "Part A progress", lbl); ws.write_formula(r, 5, f"=COUNTIF(C{a1}:C{a2},TRUE)/COUNTA(B{a1}:B{a2})", pctf, len(done_A) / len(items))
r += 2

ws.merge_range(r, 0, r, 6, "Part B: Remaining: real execution with Chemex (deadlines are PROPOSED from your 90-day plan, edit any date)", sect); r += 1
headers(r, "Week"); r += 1
b1 = r + 1
for i, (t, wk, m) in enumerate(B, 1):
    x = r + 1
    ws.write(r, 0, i, num); ws.write(r, 1, t, txt); ws.insert_checkbox(r, 2, False, chk)
    ws.write(r, 3, wk, num)
    dl = START + dt.timedelta(days=(wk - 1) * 7 + 4)
    ws.write_formula(r, 4, f"=$C$4+(D{x}-1)*7+4", datef, (dl - dt.datetime(1899, 12, 30)).days)  # Friday of that week
    ws.write_formula(r, 5, f'=IF(C{x},"Done",IF(AND(ISNUMBER(E{x}),E{x}<TODAY()),"Overdue","Open"))', num, "Overdue" if dl.date() < dt.date.today() else "Open")
    ws.set_row(r, rh((m, 70), (t, 52)))
    ws.write(r, 6, m, txt); r += 1
b2 = r
status_cf(b1, b2)
ws.write(r, 4, "Part B progress", lbl); ws.write_formula(r, 5, f"=COUNTIF(C{b1}:C{b2},TRUE)/COUNTA(B{b1}:B{b2})", pctf, 0)

ws.write_formula("C5", f"=(COUNTIF(C{a1}:C{a2},TRUE)+COUNTIF(C{b1}:C{b2},TRUE))/(COUNTA(B{a1}:B{a2})+COUNTA(B{b1}:B{b2}))", pct_big, len(done_A) / (len(items) + len(B)))
ws.freeze_panes(1, 0)
ws.set_landscape(); ws.fit_to_pages(1, 0); ws.repeat_rows(0)
ws.set_header("&L&\"Calibri,Bold\"OmniSite"); ws.set_footer("&COmniSite · Internal progress checklist · Confidential")
wb.close()
print(a1, a2, b1, b2)

```

