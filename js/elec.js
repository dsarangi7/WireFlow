/* ============================================================
 * WireFlow — electrical diagram: the system setup
 * ------------------------------------------------------------
 * AYK's battery system electrical connection diagram (e.g. DWG2527,
 * S10195) shows, per bank, the MSM back, the ACDP back, every SSC
 * back and front and the junction boxes, joined port to port. What
 * changes from system to system is the setup kept here: the banks,
 * which MSM / ACDP / SSCs belong to each, the rack every part sits
 * in (same rack = AYK harness, different racks = inline connector
 * and a customer cable) and the customer connections in use.
 *
 * Nothing here is guessed: parts read from the project's racks are
 * only proposals, and the engineer confirms the setup before any
 * sheet is drawn. Pure functions, no DOM.
 * ============================================================ */

/* Seen on the MSM back in DWG2527: comm ports SSC1P…SSC6P / SSC1B…SSC6B and Estop1…Estop6.
   Projects have 3, 6 or 9 SSCs; how they split into banks is the engineer's decision, so more
   than this on one MSM is only pointed out, never blocked. */
const ELEC_MSM_SSC_PORTS = 6;
/* cooling fans per SSC: 1 to 6 (the Cooling Fan port has pins 1 to 6) */
const ELEC_FAN_CHOICES = [1, 2, 3, 4, 5, 6];

/* MSM models, by how many SSCs they serve (each bank's model is the engineer's choice).
   Every model is drawn with the same MSM drawing, MSM.dxf (AYK, 23 Nov 2026): a model with
   fewer SSCs uses SSC ports 1 to its count and leaves the rest empty. The layouts below are
   AYK's earlier pictures of each model, kept for reference only. */
const ELEC_MSM_MODELS = {
  3: { sscs: 3, drawing: 'msm', source: 'MSM.dxf (same drawing for every model, AYK 23 Nov 2026); picture of MSM-1 back for reference',
       jacks: [['Cloud', 'EMS', 'PCS'], ['SSC1P', 'SSC2P', 'SSC3P'], ['SSC1B', 'SSC2B', 'SSC3B'], ['Spare']],
       round: [['Estop1', 'Estop2'], ['Estop3', 'Ex.FanFB', 'Dry Contact', 'RemoteE'], ['PowerP', 'PowerB', 'Valve 1', 'Valve 2']] },
  6: { sscs: 6, drawing: 'msm', source: 'MSM.dxf (same drawing for every model, AYK 23 Nov 2026); DWG2527 sheet 1 for reference',
       jacks: [['Cloud', 'EMS', 'PCS', 'Spare'], ['SSC1P', 'SSC1B', 'SSC2P', 'SSC2B'], ['SSC3P', 'SSC3B', 'SSC4P', 'SSC4B'], ['SSC5P', 'SSC5B', 'SSC6P', 'SSC6B']],
       round: [['Estop1', 'Estop2', 'Estop3'], ['Estop4', 'Estop5', 'Estop6', 'Dry Contact', 'RemoteE'], ['PowerP', 'PowerB', 'Ex.FanFB', 'Valve 1', 'Valve 2']] },
  9: { sscs: 9, drawing: 'msm', source: 'MSM.dxf (assets/elec/parts.json), names confirmed 20 Nov 2026' },
};

/* The part drawings every project uses (assets/elec/parts.json, from AYK's CADS folder).
   The junction box front is kept (AYK, 20 Nov 2026); only its HVIL wire to the SSC is gone. */
const ELEC_PARTS = ['msm', 'ssc', 'jb2', 'jb4', 'module'];

/* Ports that are never wired on new diagrams, with AYK's reason. Released projects are
   not changed. */
const ELEC_NOT_WIRED = [
  { part: 'ssc', port: 'Ext-HVIL', why: 'No junction box HVIL wire to the SSC (AYK safety decision, 20 Nov 2026): the wire is high voltage and the connector is not rated for it.' },
  { part: 'msm', match: /^SSC\d+B$/i, why: 'The backup comm link is not wired (AYK, 20 Nov 2026).' },
  { part: 'ssc', port: 'CommB', why: 'The backup comm link is not wired (AYK, 20 Nov 2026).' },
];
/** True when a port must stay unconnected on a new diagram. */
function elecPortBlocked(part, port) {
  return ELEC_NOT_WIRED.some(r => r.part === part && (r.port === '*' || (r.match ? r.match.test(String(port)) : String(r.port).toLowerCase() === String(port).toLowerCase())));
}
/** Why a port stays unconnected, or ''. */
function elecPortBlockedWhy(part, port) {
  const r = ELEC_NOT_WIRED.find(r => r.part === part && (r.port === '*' || (r.match ? r.match.test(String(port)) : String(r.port).toLowerCase() === String(port).toLowerCase())));
  return r ? r.why : '';
}

/* Customer connections at the MSM back (DWG2527 sheet 1); on = used on this system. */
const ELEC_OPTIONS = [
  { id: 'cloud', label: 'Cloud (secure remote access)', note: 'Ethernet, supplied by the customer (DOC2225)' },
  { id: 'ems', label: 'EMS port', note: 'Cat6, customer access to the BMS' },
  { id: 'pcs', label: 'PCS port', note: 'Cat6, customer access to the BMS' },
  /* always used on every project (AYK, 20 Nov 2026): never asked, always drawn */
  { id: 'remoteEstop', label: 'Customer remote E-stop (RemoteE)', note: 'LP16-4, 1 kΩ series + 10 kΩ parallel at the switch', always: true },
  { id: 'dryContact', label: 'Dry contact (thermal runaway status)', note: '25 V / 200 mA max (TN0080)', always: true },
  { id: 'extFanFb', label: 'Extraction fan failure signal', note: 'Optional; trips the bank instantly' },
  { id: 'servicing', label: '230 VAC control power inlet for battery servicing', note: 'At the ACDP' },
];

function elecNewSetup() {
  return {
    version: 1,
    banks: [],              // [{ id, name, msm: {name, rack, model}, acdps: [{name, rack}] }]
    sscs: [],               // [{ id, name, rack, bank (bank id or ''), fans (1…6 or null) }]
    options: Object.fromEntries(ELEC_OPTIONS.map(o => [o.id, o.always ? true : null])),  // null = not answered yet
    valves: null,           // master valves (fire fighting) on this system: 0, 1 or 2
    confirmed: false,
    source: null,           // how it was filled: { racks: [names], at }
  };
}

let elecSeq = 0;
function elecId(prefix) { return prefix + Date.now().toString(36) + (elecSeq++).toString(36); }

/** Natural order: SSC2 before SSC10. */
function elecCompare(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); }

/**
 * A setup proposed from the parts confirmed on the project's racks.
 * parts: [{ rack, kind: 'ssc'|'acdp'|'msm', name }]
 * One bank per MSM. An SSC or ACDP joins a bank only when its rack holds exactly one MSM;
 * everything else is left for the engineer to place.
 */
function elecFromRacks(parts, rackNames) {
  const s = elecNewSetup();
  const msms = parts.filter(p => p.kind === 'msm').sort((a, b) => elecCompare(a.name, b.name));
  msms.forEach((m, i) => s.banks.push({ id: elecId('b'), name: 'Bank ' + (i + 1), msm: { name: m.name, rack: m.rack, model: null }, acdps: [] }));
  const bankOfRack = rack => {
    const here = s.banks.filter(b => b.msm.rack === rack);
    return here.length === 1 ? here[0] : null;
  };
  for (const a of parts.filter(p => p.kind === 'acdp').sort((x, y) => elecCompare(x.name, y.name))) {
    const b = bankOfRack(a.rack);
    if (b) b.acdps.push({ name: a.name, rack: a.rack });
    else s.unplacedAcdps = (s.unplacedAcdps || []).concat({ name: a.name, rack: a.rack });
  }
  for (const c of parts.filter(p => p.kind === 'ssc').sort((x, y) => elecCompare(x.name, y.name))) {
    const b = bankOfRack(c.rack);
    s.sscs.push({ id: elecId('s'), name: c.name, rack: c.rack, bank: b ? b.id : '', fans: null });
  }
  s.source = { racks: (rackNames || []).slice(), at: new Date().toISOString() };
  return s;
}

/* Each ACDP feeds three SSCs (AYK, 20 Nov 2026): a bank has one ACDP per three SSCs. */
/** The bank's ACDPs, in order (an older setup's single ACDP becomes the first). */
function elecAcdps(b) {
  if (!Array.isArray(b.acdps)) { b.acdps = b.acdp && (b.acdp.name || b.acdp.rack) ? [b.acdp] : []; delete b.acdp; }
  return b.acdps;
}
/** How many ACDPs a bank needs: one per three SSCs, at least one. */
function elecAcdpsNeeded(setup, b) { return Math.max(1, Math.ceil(elecBankSscs(setup, b.id).length / ELEC_ACDP_SSCS)); }

/* ---------- sheets ----------
 * Numbered 1, 2, 3 … n in this order (AYK, 20 Nov 2026), as DWG2527 lays them out:
 * the two notes sheets, then bank by bank: MSM back, SSC backs (three per sheet),
 * ACDP backs, junction box and SSC fronts (three SSCs per sheet). */
const ELEC_SSCS_PER_SHEET = 3;
function elecSheets(setup) {
  const sheets = [];
  const add = (kind, title, bank, items) => sheets.push({ n: sheets.length + 1, kind: kind, title: title, bank: bank || null, items: items || [] });
  add('notes', 'Notes: MSM back and customer connections');
  add('notes', 'Notes: inline connectors, pin mapping and cables');
  for (const b of setup.banks) {
    const sscs = elecBankSscs(setup, b.id).map(c => c.name);
    const groups = [];
    for (let i = 0; i < sscs.length; i += ELEC_SSCS_PER_SHEET) groups.push(sscs.slice(i, i + ELEC_SSCS_PER_SHEET));
    add('msm', `${b.name}: ${b.msm.name || 'MSM'} back`, b.id, [b.msm.name]);
    groups.forEach(g => add('ssc-back', `${b.name}: ${g.join(', ')} back`, b.id, g));
    elecAcdps(b).slice(0, elecAcdpsNeeded(setup, b)).forEach(a => add('acdp', `${b.name}: ${a.name || 'ACDP'} back`, b.id, [a.name]));
    groups.forEach(g => add('fronts', `${b.name}: junction box and ${g.join(', ')} front`, b.id, g));
  }
  const total = sheets.length;
  sheets.forEach(s => { s.of = total; });
  return sheets;
}

/** SSCs of a bank, in name order. */
function elecBankSscs(setup, bankId) {
  return setup.sscs.filter(c => c.bank === bankId).sort((a, b) => elecCompare(a.name, b.name));
}

/**
 * What still stops the setup from being confirmed (errors) and what the engineer should
 * look at (notes). Each item: { level: 'error'|'note', text }.
 */
function elecIssues(setup) {
  const out = [];
  const err = t => out.push({ level: 'error', text: t });
  const note = t => out.push({ level: 'note', text: t });
  if (!setup.banks.length) err('Add at least one bank (one MSM each).');
  const names = new Map();
  const seen = (kind, name) => {
    const k = String(name).trim().toLowerCase();
    if (!k) return;
    if (names.has(k)) err(`The name "${name}" is used twice (${names.get(k)} and ${kind}).`);
    else names.set(k, kind);
  };
  for (const b of setup.banks) {
    const n = b.name || 'A bank';
    if (!String(b.name).trim()) err('Every bank needs a name.');
    if (!String(b.msm.name).trim()) err(`${n}: enter its MSM name.`);
    if (!String(b.msm.rack).trim()) err(`${n}: which rack is ${b.msm.name || 'its MSM'} in?`);
    const model = ELEC_MSM_MODELS[b.msm.model];
    if (!model) err(`${n}: which MSM model (3, 6 or 9 SSCs)?`);
    /* one ACDP per three SSCs (AYK, 20 Nov 2026) */
    const acdps = elecAcdps(b), need = elecAcdpsNeeded(setup, b);
    for (let k = 0; k < need; k++) {
      const a = acdps[k] || {}, feeds = `SSC ${k * ELEC_ACDP_SSCS + 1}–${k * ELEC_ACDP_SSCS + ELEC_ACDP_SSCS}`;
      if (!String(a.name || '').trim()) err(`${n}: enter the ACDP for ${feeds}${k ? '' : ' (it also feeds the MSM)'}.`);
      else if (!String(a.rack || '').trim()) err(`${n}: which rack is ${a.name} in?`);
    }
    acdps.slice(need).filter(a => String(a.name || '').trim()).forEach(a => note(`${n}: ${a.name} feeds no SSC (${need} ACDP${need === 1 ? ' is' : 's are'} enough for its SSCs).`));
    seen('a bank', b.name); seen('an MSM', b.msm.name); acdps.forEach(a => seen('an ACDP', a.name));
    const sscs = elecBankSscs(setup, b.id);
    if (!sscs.length) err(`${n} has no SSCs.`);
    if (model && sscs.length > model.sscs) err(`${n} has ${sscs.length} SSCs, but a ${model.sscs}-SSC MSM has SSC ports 1 to ${model.sscs}.`);
    if (model && !model.drawing) note(`${n}: there is no drawing of the ${model.sscs}-SSC MSM yet, so its sheet cannot be drawn until AYK adds one.`);
  }
  for (const c of setup.sscs) {
    if (!String(c.name).trim()) { err('Every SSC needs a name.'); continue; }
    seen('an SSC', c.name);
    if (!c.bank || !setup.banks.some(b => b.id === c.bank)) err(`${c.name}: choose its bank.`);
    if (!String(c.rack).trim()) err(`${c.name}: which rack is it in?`);
    if (!ELEC_FAN_CHOICES.includes(c.fans)) err(`${c.name}: how many cooling fans (1 to 6)?`);
  }
  for (const o of ELEC_OPTIONS) if (o.always) setup.options[o.id] = true;   /* older setups asked them */
  const open = ELEC_OPTIONS.filter(o => setup.options[o.id] !== true && setup.options[o.id] !== false);
  if (open.length) err(`Answer yes or no for: ${open.map(o => o.label).join('; ')}.`);
  if (![0, 1, 2].includes(setup.valves)) err('How many master valves (fire fighting): 0, 1 or 2?');
  for (const a of setup.unplacedAcdps || []) note(`${a.name} (${a.rack}) was found on the racks but not placed in a bank.`);
  return out;
}

/** True when nothing blocks confirming the setup. */
function elecReady(setup) { return !elecIssues(setup).some(i => i.level === 'error'); }

/**
 * Cables between two racks need an inline connector and a cable the customer makes
 * (dashed on AYK's diagram); within one rack AYK supplies the whole harness.
 */
function elecLinkKind(rackA, rackB) {
  const a = String(rackA || '').trim().toLowerCase(), b = String(rackB || '').trim().toLowerCase();
  if (!a || !b) return 'unknown';
  return a === b ? 'harness' : 'inline';
}

/** Counts shown on cards. */
function elecSummary(setup) {
  const s = setup || elecNewSetup();
  return { banks: s.banks.length, sscs: s.sscs.length, confirmed: !!s.confirmed };
}

/* ---------- connections ----------
 * Only rules AYK has confirmed are here; every other port waits for its rule.
 * The n-th SSC of a bank (in name order) uses the MSM's SSCn ports, as on DWG2527
 * (MSM-2 serves SSC7, SSC8 … from its first ports). */
const ELEC_RULES = [
  { id: 'comm-primary', cable: 'comm', confirmed: '2026-11-20',
    text: 'MSM SSCnP to SSCn CommP (primary communication, Cat6)' },
  { id: 'estop', cable: 'estop', confirmed: '2026-11-20',
    text: 'MSM Estop n to SSCn Estop (MSM_SSC Estop, 4 x 0.518 mm²)' },
  { id: 'ssc-power', cable: 'power', confirmed: '2026-11-20',
    text: 'ACDP SSCnP to SSCn PowerP (primary, red) and ACDP SSCnB to SSCn PowerB (backup, blue), 3 x 1.5 mm²' },
  { id: 'msm-power', cable: 'power', confirmed: '2026-11-20',
    text: 'ACDP MSMP to MSM PowerP (primary) and ACDP MSMB to MSM PowerB (backup), 3 x 1.5 mm²' },
  { id: 'ac-in', cable: 'ac-in', confirmed: '2026-11-20',
    text: "Customer AC supply to ACDP ACPowerInP (normal power) and ACPowerInB (backup UPS), inline connector, 3 x 2.5 mm²" },
  { id: 'remote-estop', cable: 'remote-estop', confirmed: '2026-11-20',
    text: 'MSM RemoteE to the client-side remote E-stop, LP16-4 inline connector, pin to pin, 4 x 0.518 mm² (always)' },
  { id: 'dry-contact', cable: 'dry-contact', confirmed: '2026-11-20',
    text: 'MSM Dry Contact to the client-side thermal runaway status signal, pins 1-2, 2 x 0.518 mm² (always)' },
  { id: 'valve', cable: 'valve', confirmed: '2026-11-20',
    text: 'MSM Valve n to Master Valve n, through an LP16-7 female to LP16-7 male connector (5 x 0.3 mm²)' },
];
/* ACDP back, left to right (AYK picture of ACDP1 back and DWG2527, 20 Nov 2026):
   it feeds three SSCs and the MSM, and takes the customer's AC power in. */
const ELEC_ACDP_PORTS = ['SSC3B', 'SSC3P', 'SSC2B', 'SSC2P', 'SSC1B', 'SSC1P', 'MSMB', 'MSMP', 'ACPowerInB', 'ACPowerInP'];
const ELEC_ACDP_SSCS = 3;
/* The SSC Cooling Fan port is one connector, pins 1 to 6 (AYK, 20 Nov 2026). */
const ELEC_FAN_PINS = 6;

/**
 * The connections a confirmed setup gives under ELEC_RULES:
 * [{ rule, cable, from: {part, name, port}, to: {part, name, port}, link: 'harness'|'inline'|'unknown', bank }]
 */
function elecLinks(setup) {
  const out = [];
  for (const b of setup.banks) {
    elecBankSscs(setup, b.id).forEach((c, i) => {
      const n = i + 1;
      const model = ELEC_MSM_MODELS[b.msm.model];
      if (n > (model ? model.sscs : 9)) return;   /* past the MSM's SSC ports */
      out.push({ rule: 'comm-primary', cable: 'comm', bank: b.id,
        from: { part: 'msm', name: b.msm.name, port: 'SSC' + n + 'P' },
        to: { part: 'ssc', name: c.name, port: 'CommP' },
        link: elecLinkKind(b.msm.rack, c.rack) });
      out.push({ rule: 'estop', cable: 'estop', bank: b.id,
        from: { part: 'msm', name: b.msm.name, port: 'Estop' + n },
        to: { part: 'ssc', name: c.name, port: 'Estop' },
        link: elecLinkKind(b.msm.rack, c.rack) });
    });
  }
  /* power: ACDP k feeds SSCs 3k+1 to 3k+3 from its SSC1-3 ports; the first ACDP also feeds
     the MSM (as on AYK's ACDP1 picture); every ACDP takes the customer's AC in */
  for (const b of setup.banks) {
    const acdps = elecAcdps(b);
    const named = a => a && String(a.name || '').trim();
    elecBankSscs(setup, b.id).forEach((c, i) => {
      const a = acdps[Math.floor(i / ELEC_ACDP_SSCS)];
      if (!named(a)) return;
      for (const pb of ['P', 'B']) out.push({ rule: 'ssc-power', cable: 'power-' + pb, bank: b.id,
        from: { part: 'acdp', name: a.name, port: 'SSC' + (i % ELEC_ACDP_SSCS + 1) + pb },
        to: { part: 'ssc', name: c.name, port: 'Power' + pb }, link: elecLinkKind(a.rack, c.rack) });
    });
    if (named(acdps[0])) for (const pb of ['P', 'B']) out.push({ rule: 'msm-power', cable: 'power-' + pb, bank: b.id,
      from: { part: 'acdp', name: acdps[0].name, port: 'MSM' + pb },
      to: { part: 'msm', name: b.msm.name, port: 'Power' + pb }, link: elecLinkKind(acdps[0].rack, b.msm.rack) });
    acdps.slice(0, elecAcdpsNeeded(setup, b)).filter(named).forEach(a => {
      for (const pb of ['P', 'B']) out.push({ rule: 'ac-in', cable: 'ac-in-' + pb, bank: b.id,
        from: { part: 'customer', name: pb === 'P' ? 'Normal power' : 'Backup UPS', port: 'L/N/G' },
        to: { part: 'acdp', name: a.name, port: 'ACPowerIn' + pb }, link: 'inline' });
    });
  }
  /* always: the customer's remote E-stop and the thermal runaway status signal (dry contact) */
  for (const b of setup.banks) {
    out.push({ rule: 'remote-estop', cable: 'remote-estop', bank: b.id,
      from: { part: 'msm', name: b.msm.name, port: 'RemoteE' },
      to: { part: 'customer', name: 'Client-side remote E-stop', port: 'Pin 1-4' }, via: 'LP16-4 inline connector', link: 'inline' });
    out.push({ rule: 'dry-contact', cable: 'dry-contact', bank: b.id,
      from: { part: 'msm', name: b.msm.name, port: 'Dry Contact' },
      to: { part: 'customer', name: 'Client-side thermal runaway status signal', port: 'Pin 1-2' }, link: 'inline' });
  }
  /* master valves: one to each of the bank's MSM valve ports in use */
  for (const b of setup.banks) for (let v = 1; v <= Math.min(2, setup.valves || 0); v++)
    out.push({ rule: 'valve', cable: 'valve', bank: b.id,
      from: { part: 'msm', name: b.msm.name, port: 'Valve ' + v },
      to: { part: 'valve', name: 'Master Valve' + v, port: 'LP16-7' },
      via: 'LP16-7 female to LP16-7 male connector', link: 'customer' });
  return out.filter(l => !elecPortBlocked(l.from.part, l.from.port) && !elecPortBlocked(l.to.part, l.to.port));
}

if (typeof module !== 'undefined') module.exports = { elecSheets, ELEC_SSCS_PER_SHEET, elecPortBlockedWhy, elecAcdps, elecAcdpsNeeded, ELEC_FAN_CHOICES, ELEC_ACDP_PORTS, ELEC_ACDP_SSCS, ELEC_MSM_MODELS, ELEC_FAN_PINS, ELEC_RULES, elecLinks, ELEC_PARTS, ELEC_NOT_WIRED, elecPortBlocked, ELEC_MSM_SSC_PORTS, ELEC_OPTIONS, elecNewSetup, elecFromRacks, elecBankSscs, elecIssues, elecReady, elecLinkKind, elecSummary, elecCompare };
