// Vaccinations given (Services, 2026-11-09): the new screen records a vaccination with exactly the row the API stores
// for the same input; the remembered batch comes back for the same vaccine; the recall is listed and the next dose
// closes it; "Reaction" opens a pre-filled adverse-reaction report whose saved keys are those of a typed report.
// Nothing touches orders or stock.
const malta = (n = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + n * 864e5));
const IN = { first: "Ċensina", last: "Vaxtestu", phone: "79555123", vaccine: "Engerix-B Vx", batch: "ENGVX77", expiry: malta(300), site: "Right upper arm", consent: "Parent or guardian", dose: "Dose 1", next: malta(30) };
export default {
  title: "Vaccinations given",
  async run(t) {
    const V = "vaccinations";
    await t.api("GET", "/vaccines/stock/rows"); // makes the vaccine tables
    const stockBefore = JSON.stringify(t.db.prepare("SELECT * FROM vaccines_stock ORDER BY id").all());
    let m0 = t.maxId(V);
    const r = await t.api("POST", "/vaccines/given", { given_on: malta(0), client_first: IN.first, client_last: IN.last, phone: IN.phone, email: "", id_card: "", vaccine_name: IN.vaccine, dose: IN.dose, batch: IN.batch, expiry_date: IN.expiry, site: IN.site, consent_by: IN.consent, next_due: IN.next, order_id: 0, notes: "" });
    t.ok(r && r.ok, "API body accepted: " + JSON.stringify(r).slice(0, 160));
    const api = (await t.mine(V, m0, { client_last: IN.last }))[0];

    const p = await t.page();
    await t.open(p, "2", "vaccines", "vaxreg", "[data-act=give]");
    m0 = t.maxId(V);
    await p.click(".vxr-top [data-act=give]"); await p.waitForSelector("#vxg-add");
    await t.fill(p, "#vxg-add", { client_first: IN.first, client_last: IN.last, phone: IN.phone, vaccine_name: IN.vaccine });
    await p.waitForTimeout(100);
    const remembered = await p.evaluate(() => ({ b: document.querySelector("#vxg-add [name=batch]").value, e: document.querySelector("#vxg-add [name=expiry_date]").value }));
    t.ok(remembered.b === IN.batch && remembered.e === IN.expiry, "the batch and expiry last used for this vaccine come back by themselves: " + JSON.stringify(remembered));
    // nothing is pre-chosen for consent; saving without it is refused next to the field
    const pre = await p.evaluate(() => [...document.querySelectorAll("#vxg-add [data-act=gcons]")].map((b) => b.getAttribute("aria-checked")));
    t.ok(pre.every((x) => x === "false"), "consent is not pre-ticked: " + pre);
    await p.click('#vxg-add [data-act=gdose][data-v="' + IN.dose + '"]');
    await p.click('#vxg-add [data-act=gsite][data-v="' + IN.site + '"]');
    await t.fill(p, "#vxg-add", { next_due: IN.next });
    await p.click("#vxg-add button[type=submit]"); await p.waitForTimeout(200);
    const refused = await p.evaluate(() => ({ err: (document.querySelector("#vxg-add [role=alert]") || {}).textContent || "", inv: !!document.querySelector("#vxg-add [role=radiogroup][aria-label=Consent][aria-invalid=true]") }));
    t.ok(/consent/i.test(refused.err) && refused.inv && t.since(V, m0).length === 0, "no consent, nothing saved, said beside the field: " + JSON.stringify(refused));
    await p.click('#vxg-add [data-act=gcons][data-v="' + IN.consent + '"]');
    await t.write(p, /\/vaccines\/given$/, () => p.click("#vxg-add button[type=submit]"));
    const ui = (await t.mine(V, m0, { client_last: IN.last }))[0];
    t.has("vaccination (new screen)", ui, { client_first: IN.first, client_last: IN.last, phone: IN.phone, vaccine_name: IN.vaccine, dose: IN.dose, batch: IN.batch, expiry_date: IN.expiry, site: IN.site, consent_by: IN.consent, next_due: IN.next, given_on: malta(0), next_state: 0 });
    t.same("vaccination", api, ui, { id: "own row", created_at: "time of saving", closed_at: "the second dose closes the API's recall (same person, same vaccine)", next_state: "the second dose closes the API's recall", closed_by: "the second dose closes the API's recall" });
    t.ok(t.row(V, api.id).next_state === 1, "recording it again closed the earlier open recall for the same person and vaccine");
    t.ok(JSON.stringify(t.db.prepare("SELECT * FROM vaccines_stock ORDER BY id").all()) === stockBefore, "vaccine stock unchanged");

    // the history of the person, then a reaction after this vaccine
    await p.waitForSelector(".vxg-row.new");
    await p.click('.vxg-row [data-act=hist][data-gid="' + ui.id + '"]'); await p.waitForSelector(".vxg-hist .vxg-row");
    const hist = await p.evaluate(() => document.querySelectorAll(".vxg-hist .vxg-row").length);
    t.ok(hist === 2, "the person's history lists both vaccinations: " + hist);
    await p.click('.vxg-hist [data-act=react][data-gid="' + ui.id + '"]');
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "pvreg" && document.querySelector("#pvr-add"), null, { timeout: 15000 });
    const filled = await p.evaluate(() => ({ ini: document.querySelector("[name=pt_initials]").value, med: document.querySelector('[data-i="0"][data-k=name]').value, batch: document.querySelector('[data-i="0"][data-k=batch_no]').value, route: document.querySelector('[data-i="0"][data-k=route]').value, start: document.querySelector('[data-i="0"][data-k=start_date]').value, note: (document.querySelector(".pvr-pre") || {}).textContent || "" }));
    t.ok(filled.ini === "Ċ.V." && filled.med === IN.vaccine && filled.batch === IN.batch && filled.route === "IM" && filled.start === malta(0) && /Ċensina Vaxtestu/.test(filled.note), "the report opens filled from the vaccination: " + JSON.stringify(filled));
    await p.fill("[name=reaction_meddra]", "Injection site reaction");
    const pv0 = t.maxId("pv_reports");
    await t.write(p, /\/pharmacovigilance\/state$/, () => p.click("#pvr-add button[type=submit]"), "PUT");
    const row = (await t.mine("pv_reports", pv0))[0], rep = row && JSON.parse(row.report_json);
    const typedKeys = ["created_at", "drugs", "id", "notes", "pt_age", "pt_dob_day", "pt_dob_month", "pt_height", "pt_id", "pt_initials", "pt_medical_history", "pt_sex", "pt_weight", "reaction_causality", "reaction_description", "reaction_meddra", "reaction_outcome", "reaction_seriousness", "reaction_start", "reaction_stop", "report_date", "report_type", "reporter_address", "reporter_email", "reporter_institution", "reporter_name", "reporter_phone", "reporter_qualification", "status", "updated_at"];
    t.ok(rep && JSON.stringify(Object.keys(rep).sort()) === JSON.stringify(typedKeys), "the saved report has exactly the keys of a typed report: " + (rep && Object.keys(rep).sort().join(",")));
    t.ok(rep && rep.status === "Draft" && rep.drugs.length === 1 && rep.drugs[0].name === IN.vaccine && rep.drugs[0].batch_no === IN.batch && JSON.stringify(Object.keys(rep.drugs[0]).sort()) === JSON.stringify(["batch_no", "dose", "frequency", "indication", "mah", "name", "route", "start_date", "stop_date"]), "the vaccine is the suspected medicine with its batch: " + JSON.stringify(rep && rep.drugs));
  },
};
