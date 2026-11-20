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
const ELEC_FAN_CHOICES = [2, 3];

/* The part drawings every project uses (assets/elec/parts.json, from AYK's CADS folder).
   There is no junction box on future projects, so none is drawn. */
const ELEC_PARTS = ['msm', 'ssc', 'module'];

/* Ports that are never wired on new diagrams, with AYK's reason. Released projects are
   not changed. */
const ELEC_NOT_WIRED = [
  { part: 'ssc', port: 'Ext-HVIL', why: 'No junction box HVIL wire to the SSC (AYK safety decision, 20 Nov 2026): the wire is high voltage and the connector is not rated for it.' },
  { part: 'jb', port: '*', why: 'No junction box on future projects.' },
];
/** True when a port must stay unconnected on a new diagram. */
function elecPortBlocked(part, port) {
  return ELEC_NOT_WIRED.some(r => r.part === part && (r.port === '*' || String(r.port).toLowerCase() === String(port).toLowerCase()));
}

/* Customer connections at the MSM back (DWG2527 sheet 1); on = used on this system. */
const ELEC_OPTIONS = [
  { id: 'cloud', label: 'Cloud (secure remote access)', note: 'Ethernet, supplied by the customer (DOC2225)' },
  { id: 'ems', label: 'EMS port', note: 'Cat6, customer access to the BMS' },
  { id: 'pcs', label: 'PCS port', note: 'Cat6, customer access to the BMS' },
  { id: 'remoteEstop', label: 'Customer remote E-stop (RemoteE)', note: 'LP16-4, 1 kΩ series + 10 kΩ parallel at the switch' },
  { id: 'dryContact', label: 'Dry contact (thermal runaway status)', note: '25 V / 200 mA max (TN0080)' },
  { id: 'extFanFb', label: 'Extraction fan failure signal', note: 'Optional; trips the bank instantly' },
  { id: 'servicing', label: '230 VAC control power inlet for battery servicing', note: 'At the ACDP' },
];

function elecNewSetup() {
  return {
    version: 1,
    banks: [],              // [{ id, name, msm: {name, rack}, acdp: {name, rack} }]
    sscs: [],               // [{ id, name, rack, bank (bank id or ''), fans (2|3|null) }]
    options: Object.fromEntries(ELEC_OPTIONS.map(o => [o.id, null])),  // null = not answered yet
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
  msms.forEach((m, i) => s.banks.push({ id: elecId('b'), name: 'Bank ' + (i + 1), msm: { name: m.name, rack: m.rack }, acdp: { name: '', rack: '' } }));
  const bankOfRack = rack => {
    const here = s.banks.filter(b => b.msm.rack === rack);
    return here.length === 1 ? here[0] : null;
  };
  for (const a of parts.filter(p => p.kind === 'acdp').sort((x, y) => elecCompare(x.name, y.name))) {
    const b = bankOfRack(a.rack);
    if (b && !b.acdp.name) b.acdp = { name: a.name, rack: a.rack };
    else s.unplacedAcdps = (s.unplacedAcdps || []).concat({ name: a.name, rack: a.rack });
  }
  for (const c of parts.filter(p => p.kind === 'ssc').sort((x, y) => elecCompare(x.name, y.name))) {
    const b = bankOfRack(c.rack);
    s.sscs.push({ id: elecId('s'), name: c.name, rack: c.rack, bank: b ? b.id : '', fans: null });
  }
  s.source = { racks: (rackNames || []).slice(), at: new Date().toISOString() };
  return s;
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
    /* the ACDP is optional: the diagram is drawn from the MSM, SSC and module drawings */
    if (String(b.acdp.name).trim() && !String(b.acdp.rack).trim()) err(`${n}: which rack is ${b.acdp.name} in?`);
    seen('a bank', b.name); seen('an MSM', b.msm.name); seen('an ACDP', b.acdp.name);
    const sscs = elecBankSscs(setup, b.id);
    if (!sscs.length) err(`${n} has no SSCs.`);
    if (sscs.length > ELEC_MSM_SSC_PORTS) note(`${n} has ${sscs.length} SSCs on one MSM; the MSM back in DWG2527 shows SSC ports 1 to ${ELEC_MSM_SSC_PORTS}. Check this split is intended.`);
  }
  for (const c of setup.sscs) {
    if (!String(c.name).trim()) { err('Every SSC needs a name.'); continue; }
    seen('an SSC', c.name);
    if (!c.bank || !setup.banks.some(b => b.id === c.bank)) err(`${c.name}: choose its bank.`);
    if (!String(c.rack).trim()) err(`${c.name}: which rack is it in?`);
    if (!ELEC_FAN_CHOICES.includes(c.fans)) err(`${c.name}: how many cooling fans (2 or 3)?`);
  }
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

if (typeof module !== 'undefined') module.exports = { ELEC_PARTS, ELEC_NOT_WIRED, elecPortBlocked, ELEC_MSM_SSC_PORTS, ELEC_OPTIONS, elecNewSetup, elecFromRacks, elecBankSscs, elecIssues, elecReady, elecLinkKind, elecSummary, elecCompare };
