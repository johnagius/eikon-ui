// Adverse reactions (pvreg): reports not sent yet come first; "Mark as sent to MPA" stores exactly what choosing
// "Submitted to MPA" in the form and saving stores (the whole report, only the status and updated_at changed).
const F = ["status", "report_type", "pt_initials", "pt_age", "pt_sex", "pt_weight", "pt_height", "pt_dob_day", "pt_dob_month", "pt_id", "pt_medical_history",
  "reaction_description", "reaction_start", "reaction_stop", "reaction_seriousness", "reaction_outcome", "reaction_causality", "reaction_meddra",
  "reporter_name", "reporter_qualification", "reporter_email", "reporter_phone", "reporter_institution", "reporter_address", "report_date", "notes"];
function report(id, extra) {
  const r = { id, created_at: "2026-10-02T09:00:00.000Z", updated_at: "2026-10-02T09:00:00.000Z", mpa_ref: "kept", drugs: [{ name: "Influvac Tetra", dose: "0.5 ml", route: "IM", frequency: "", start_date: "2026-10-01", stop_date: "", indication: "Vaccination", batch_no: "M78", mah: "" }] };
  for (const k of F) r[k] = "";
  return Object.assign(r, { status: "Draft", report_type: "Initial", pt_initials: "Ħ.Ż.", reaction_meddra: "Pyrexia", reaction_seriousness: "Non-serious", reaction_outcome: "Recovering", reaction_causality: "Possible", report_date: "2026-10-02", reporter_name: "Maria Borg", reporter_qualification: "Pharmacist" }, extra || {});
}
export default {
  title: "Adverse reactions: not sent yet, mark as sent",
  async run(t) {
    const A = report("pv_case_mark_a"), B = report("pv_case_mark_b");
    const put = await t.api("PUT", "/pharmacovigilance/state", { state: { reports: [A, B], deleted_ids: [] } });
    t.ok(put && put.ok, "seeded two drafts");
    const read = (id) => { const r = t.db.prepare("SELECT report_json FROM pv_reports WHERE report_id = ?").get(id); return r && JSON.parse(r.report_json); };
    const p = await t.page();
    await t.open(p, "2", "pharmacovigilance", "pvreg", ".pvr-row");
    const look = await p.evaluate(() => ({ lab: (document.querySelector(".pvr-lab") || {}).textContent || "", pill: (document.querySelector('.pvr-row[data-id="pv_case_mark_a"] .pvr-pill.w') || {}).textContent || "" }));
    t.ok(/^Not sent yet/.test(look.lab) && /^Not sent yet · \d+ days$/.test(look.pill), "drafts first, in words, with how long they wait: " + JSON.stringify(look));
    // B the long way: open, Correct, choose the status, save
    await p.click('.pvr-row[data-id="pv_case_mark_b"]'); await p.click("[data-act=edit]"); await p.selectOption("[name=status]", "Submitted to MPA");
    await t.write(p, /\/pharmacovigilance\/state$/, () => p.click("#pvr-add button[type=submit]"), "PUT");
    await p.waitForSelector("[data-act=list]"); await p.click("[data-act=list]");
    // A in one tap
    await p.click('.pvr-row[data-id="pv_case_mark_a"]'); await p.waitForSelector("[data-act=sent]");
    const sent = await t.write(p, /\/pharmacovigilance\/state$/, () => p.click("[data-act=sent]"), "PUT");
    t.ok(sent.body && sent.body.state && sent.body.state.reports.length === 1 && Array.isArray(sent.body.state.deleted_ids) && !sent.body.state.deleted_ids.length, "one report in the PUT, nothing deleted");
    await p.waitForFunction(() => !document.querySelector("[data-act=sent]"), null, { timeout: 8000 });
    const a = read("pv_case_mark_a"), b = read("pv_case_mark_b");
    t.ok(a && a.status === "Submitted to MPA" && a.mpa_ref === "kept", "marked as sent; a field the form does not show is kept");
    const strip = (r, id) => JSON.stringify(Object.assign({}, r, { id, updated_at: "" }));
    t.ok(strip(a, "x") === strip(b, "x"), "one tap stores exactly what the form stores for the same change:\n tap  " + strip(a, "x").slice(0, 300) + "\n form " + strip(b, "x").slice(0, 300));
    t.ok(strip(a, "x") === strip(Object.assign({}, A, { status: "Submitted to MPA" }), "x"), "only the status (and updated_at) changed");
    // the Not sent yet filter
    await p.click("[data-act=list]"); await p.click("[data-act=f-draft]");
    const ids = await p.evaluate(() => [...document.querySelectorAll(".pvr-row")].map((r) => r.getAttribute("data-id")));
    t.ok(!ids.includes("pv_case_mark_a") && !ids.includes("pv_case_mark_b"), "Not sent yet no longer lists them: " + ids.join(","));
  },
};
