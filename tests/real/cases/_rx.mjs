// Shared by cdsreg (DDA sales) and poyreg (POYC): the classic screen's modal, then the new prescription form.
export async function rxCase(t, o) {
  const p = await t.page(), IN = o.input;
  await t.open(p, "classic", o.hash, o.classicId, "button:has-text('New Entry')");
  let m = t.maxId(o.table);
  await p.click("button:has-text('New Entry')"); await p.waitForSelector(".eikon-dda-modal input[type=date]");
  const M = ".eikon-dda-modal ";
  await t.fill(p, "", { [M + "input[type=date]"]: IN.date, [M + "input[type=number]"]: IN.qty, ...Object.fromEntries(Object.entries(o.classicPh).map(([k, ph]) => [M + `input[placeholder="${ph}"]`, IN[k]])) });
  if (IN.urgent && o.urgent) await p.locator(M + "input[type=checkbox]").first().check();
  await t.write(p, new RegExp(o.path + "$"), () => p.click(M + "button.eikon-dda-btn:has-text('Save')"));
  const classic = t.since(o.table, m)[0];
  await t.open(p, "2", o.hash, o.newId, "[data-act=add]");
  m = t.maxId(o.table);
  await p.click("[data-act=add]"); await p.waitForSelector("#cds-add");
  await t.fill(p, "#cds-add", { entry_date: IN.date, client_id_card: IN.id, client_name: IN.name, client_address: IN.addr, doctor_name: IN.doc, doctor_reg_no: IN.reg, prescription_serial_no: IN.serial, '#cds-add [data-i="0"][data-k=medicine_name_dose]': IN.med, '#cds-add [data-i="0"][data-k=quantity]': IN.qty });
  if (IN.urgent && o.urgent) await p.check("#cds-add [name=urgent]");
  // the same serial as the classic entry: the new screen shows it first, a second press records (the rest of a part-supply)
  await p.click("#cds-add button[type=submit]"); await p.waitForSelector(".cds-dup");
  t.ok(/already has 1 entry/.test(await p.textContent(".cds-dup")), o.label + ": the serial already used is shown before saving");
  await t.write(p, new RegExp(o.path + "$"), () => p.click("#cds-add button[type=submit]"));
  const fresh = t.since(o.table, m)[0];
  t.has(o.label + "(new)", fresh, o.want);
  t.same(o.label, classic, fresh, o.allow || {});
}
