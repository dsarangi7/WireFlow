/* Electrical diagram setup: proposals from racks, issues, link kind. */
const assert = require('assert');
const E = require('../js/elec.js');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

/* a new setup answers nothing for the engineer */
const fresh = E.elecNewSetup();
eq(fresh.banks.length, 0, 'no banks');
ok(fresh.options.remoteEstop === true && fresh.options.dryContact === true, 'remote E-stop and dry contact are always on');
ok(Object.entries(fresh.options).filter(([k]) => k !== 'remoteEstop' && k !== 'dryContact').every(([, v]) => v === null), 'other options unanswered');
ok(!E.elecReady(fresh), 'empty setup is not ready');

/* S10195-like: rack 1 has MSM-1, ACDP2, SSC1-3; rack 2 has SSC4-6 and no MSM */
const parts = [
  { rack: 'Rack 1', kind: 'msm', name: 'MSM-1' }, { rack: 'Rack 1', kind: 'acdp', name: 'ACDP2' },
  { rack: 'Rack 1', kind: 'ssc', name: 'SSC2' }, { rack: 'Rack 1', kind: 'ssc', name: 'SSC1' }, { rack: 'Rack 1', kind: 'ssc', name: 'SSC3' },
  { rack: 'Rack 2', kind: 'ssc', name: 'SSC4' }, { rack: 'Rack 2', kind: 'ssc', name: 'SSC10' }, { rack: 'Rack 2', kind: 'ssc', name: 'SSC5' },
];
const s = E.elecFromRacks(parts, ['Rack 1', 'Rack 2']);
eq(s.banks.length, 1, 'one bank per MSM');
eq(s.banks[0].msm, { name: 'MSM-1', rack: 'Rack 1', model: null }, 'MSM placed, its model left to the engineer');
eq(s.banks[0].acdps, [{ name: 'ACDP2', rack: 'Rack 1' }], 'ACDP in the MSM rack joins the bank');
eq(s.sscs.map(c => c.name), ['SSC1', 'SSC2', 'SSC3', 'SSC4', 'SSC5', 'SSC10'], 'SSCs in natural order');
eq(s.sscs.filter(c => c.bank).map(c => c.name), ['SSC1', 'SSC2', 'SSC3'], 'only SSCs in the MSM rack are placed');
ok(s.sscs.every(c => c.fans === null), 'fan count is never guessed');
ok(!E.elecReady(s), 'proposal still needs answers');
const msgs = E.elecIssues(s).map(i => i.text).join('\n');
ok(/SSC4: choose its bank/.test(msgs), 'unplaced SSC reported');
ok(/cooling fans/.test(msgs), 'fan count asked');
ok(/master valves/.test(msgs), 'valves asked');

/* answer everything */
ok(/which MSM model/.test(E.elecIssues(s).map(i => i.text).join()), 'MSM model asked');
s.banks[0].msm.model = 9;
for (const c of s.sscs) { c.bank = s.banks[0].id; c.fans = 3; }
for (const k of Object.keys(s.options)) s.options[k] = true;
s.valves = 2;
ok(/Which junction box: 2 or 4/.test(E.elecIssues(s).map(i => i.text).join()), 'junction box asked');
s.jbModel = 4;
/* six SSCs: two ACDPs (one per three SSCs) */
ok(/enter the ACDP for SSC 4–6/.test(E.elecIssues(s).map(i => i.text).join()), 'six SSCs need a second ACDP');
const keepAcdps = s.banks[0].acdps;
s.banks[0].acdps = [];
ok(/enter the ACDP for SSC 1–3 \(it also feeds the MSM\)/.test(E.elecIssues(s).map(i => i.text).join()), 'the first ACDP is asked for');
s.banks[0].acdps = [{ name: 'ACDP2', rack: 'Rack 1' }, { name: 'ACDP3', rack: '' }];
ok(!E.elecReady(s) && /which rack is ACDP3 in/.test(E.elecIssues(s).map(i => i.text).join()), 'a named ACDP needs its rack');
s.banks[0].acdps = keepAcdps.concat({ name: 'ACDP3', rack: 'Rack 2' });
ok(E.elecReady(s), 'complete setup is ready: ' + E.elecIssues(s).map(i => i.text).join('; '));

/* an MSM serves at most 6 SSCs */
s.banks[0].msm.model = 3;
ok(/3-SSC MSM has SSC ports 1 to 3/.test(E.elecIssues(s).map(i => i.text).join()), 'more SSCs than the MSM model serves is an error');
ok(!E.elecIssues(s).some(i => /no drawing of the/.test(i.text)), 'every MSM model uses MSM.dxf, so none lacks a drawing');
ok(Object.values(E.ELEC_MSM_MODELS).every(m => m.drawing === 'msm'), 'one MSM drawing for 3, 6 and 9 SSCs');
s.banks[0].msm.model = 9;
ok(E.elecReady(s), '6 SSCs on a 9-SSC MSM is fine');

/* duplicate names */
s.sscs[1].name = 'SSC1';
ok(/used twice/.test(E.elecIssues(s).map(i => i.text).join()), 'duplicate names caught');
s.sscs[1].name = 'SSC2';

/* module counts come from the racks; a missing one is a note, not a blocker */
const counted = E.elecFromRacks([{ rack: 'R', kind: 'msm', name: 'MSM-1' }, { rack: 'R', kind: 'ssc', name: 'SSC1', modules: 12 }, { rack: 'R', kind: 'ssc', name: 'SSC2' }], ['R']);
eq(counted.sscs.map(c => c.modules), [12, null], 'module count carried from the rack');
const cn = E.elecIssues(counted).filter(i => /battery modules/.test(i.text));
ok(cn.length === 1 && /SSC2/.test(cn[0].text) && cn[0].level !== 'error', 'missing module count is a note');

/* two MSMs in one rack: nothing in that rack is placed automatically */
const two = E.elecFromRacks([{ rack: 'R', kind: 'msm', name: 'MSM-2' }, { rack: 'R', kind: 'msm', name: 'MSM-1' }, { rack: 'R', kind: 'ssc', name: 'SSC1' }], ['R']);
eq(two.banks.map(b => b.msm.name), ['MSM-1', 'MSM-2'], 'banks follow MSM names');
eq(two.sscs[0].bank, '', 'ambiguous rack leaves the SSC to the engineer');

/* harness within a rack, inline connector between racks */
eq(E.elecLinkKind('Rack 1', 'rack 1'), 'harness', 'same rack');
eq(E.elecLinkKind('Rack 1', 'Rack 2'), 'inline', 'different racks');
eq(E.elecLinkKind('Rack 1', ''), 'unknown', 'rack not given');

/* never wired on new diagrams */
ok(E.elecPortBlocked('ssc', 'Ext-HVIL') && E.elecPortBlocked('ssc', 'ext-hvil'), 'SSC Ext-HVIL is not wired');
ok(!E.elecPortBlocked('jb', 'Bus+'), 'the junction box front is kept');
ok(!E.elecPortBlocked('ssc', 'PowerP'), 'other SSC ports are wired');
ok(E.elecPortBlocked('msm', 'SSC3B') && E.elecPortBlocked('msm', 'SSC9B') && E.elecPortBlocked('ssc', 'CommB'), 'backup comm is not wired');
ok(!E.elecPortBlocked('msm', 'SSC3P') && !E.elecPortBlocked('ssc', 'CommP'), 'primary comm is wired');
eq(E.ELEC_PARTS, ['msm', 'ssc', 'jb2', 'jb4', 'acdp', 'module'], 'the part drawings');

/* confirmed connection: MSM SSCnP -> SSCn CommP, n = position of the SSC in its bank */
const two2 = E.elecNewSetup();
two2.banks.push({ id: 'b1', name: 'Bank 1', msm: { name: 'MSM-1', rack: 'Rack 1', model: 3 }, acdps: [] });
two2.banks.push({ id: 'b2', name: 'Bank 2', msm: { name: 'MSM-2', rack: 'Rack 3', model: 9 }, acdp: { name: '', rack: '' } });  /* an older setup: one ACDP field */
['SSC1', 'SSC2', 'SSC3'].forEach((nm, i) => two2.sscs.push({ id: 'a' + i, name: nm, rack: i < 2 ? 'Rack 1' : 'Rack 2', bank: 'b1', fans: 2 }));
['SSC8', 'SSC7'].forEach((nm, i) => two2.sscs.push({ id: 'c' + i, name: nm, rack: 'Rack 3', bank: 'b2', fans: 3 }));
const all = E.elecLinks(two2);
const links = all.filter(l => l.rule === 'comm-primary');
eq(all.filter(l => l.rule === 'estop').map(l => `${l.from.name}.${l.from.port}>${l.to.name}.${l.to.port}:${l.link}`),
  ['MSM-1.Estop1>SSC1.Estop:harness', 'MSM-1.Estop2>SSC2.Estop:harness', 'MSM-1.Estop3>SSC3.Estop:inline',
   'MSM-2.Estop1>SSC7.Estop:harness', 'MSM-2.Estop2>SSC8.Estop:harness'], 'Estop links per bank');
eq(links.map(l => `${l.from.name}.${l.from.port}>${l.to.name}.${l.to.port}:${l.link}`),
  ['MSM-1.SSC1P>SSC1.CommP:harness', 'MSM-1.SSC2P>SSC2.CommP:harness', 'MSM-1.SSC3P>SSC3.CommP:inline',
   'MSM-2.SSC1P>SSC7.CommP:harness', 'MSM-2.SSC2P>SSC8.CommP:harness'], 'primary comm links per bank');
ok(links.every(l => l.cable === 'comm'), 'comm cable');
two2.valves = 2;
eq(E.elecLinks(two2).filter(l => l.rule === 'valve').map(l => `${l.from.name}.${l.from.port}>${l.to.name}`),
  ['MSM-1.Valve 1>Master Valve1', 'MSM-1.Valve 2>Master Valve2', 'MSM-2.Valve 1>Master Valve1', 'MSM-2.Valve 2>Master Valve2'], 'master valves per bank');
two2.valves = 1;
eq(E.elecLinks(two2).filter(l => l.rule === 'valve').length, 2, 'one valve per bank when 1 is chosen');
const cust = E.elecLinks(two2).filter(l => l.bank === 'b1' && /remote-estop|dry-contact/.test(l.rule)).map(l => `${l.from.port}>${l.to.name}`);
eq(cust, ['RemoteE>Client-side remote E-stop', 'Dry Contact>Client-side thermal runaway status signal'], 'customer E-stop and dry contact always drawn');
const old = E.elecNewSetup(); old.options.remoteEstop = null; old.options.dryContact = null;
ok(!/Customer remote E-stop|Dry contact/.test(E.elecIssues(old).map(i => i.text).join()), 'never asked, even on an older setup');
eq(E.ELEC_FAN_PINS, 6, 'Cooling Fan port has pins 1 to 6');
eq(E.ELEC_FAN_CHOICES, [1, 2, 3, 4, 5, 6], 'cooling fans: 1 to 6');

/* power from the ACDP (AYK picture of ACDP1 back) */
two2.banks[0].acdps = [{ name: 'ACDP1', rack: 'Rack 1' }];
const pw = E.elecLinks(two2).filter(l => l.bank === 'b1' && /power|ac-in/.test(l.rule)).map(l => `${l.from.name}.${l.from.port}>${l.to.name}.${l.to.port}:${l.link}`);
eq(pw, ['ACDP1.SSC1P>SSC1.PowerP:harness', 'ACDP1.SSC1B>SSC1.PowerB:harness', 'ACDP1.SSC2P>SSC2.PowerP:harness', 'ACDP1.SSC2B>SSC2.PowerB:harness',
  'ACDP1.SSC3P>SSC3.PowerP:inline', 'ACDP1.SSC3B>SSC3.PowerB:inline', 'ACDP1.MSMP>MSM-1.PowerP:harness', 'ACDP1.MSMB>MSM-1.PowerB:harness',
  'Normal power.L/N/G>ACDP1.ACPowerInP:inline', 'Backup UPS.L/N/G>ACDP1.ACPowerInB:inline'], 'ACDP feeds SSC1-3, the MSM, and takes AC in');
eq(E.ELEC_ACDP_PORTS, ['SSC3B', 'SSC3P', 'SSC2B', 'SSC2P', 'SSC1B', 'SSC1P', 'MSMB', 'MSMP', 'ACPowerInB', 'ACPowerInP'], 'ACDP back order');
eq(E.elecLinks(two2).filter(l => l.bank === 'b2' && l.rule === 'ssc-power').length, 0, 'no ACDP named, no power links');
ok(Array.isArray(two2.banks[1].acdps) && !('acdp' in two2.banks[1]), 'an older single ACDP field is converted');

/* six SSCs on one MSM: ACDP1 feeds SSC1-3 and the MSM, ACDP2 feeds SSC4-6 from its SSC1-3 ports */
const six = E.elecNewSetup();
six.banks.push({ id: 'k', name: 'Bank 1', msm: { name: 'MSM-1', rack: 'R1', model: 6 }, acdps: [{ name: 'ACDP1', rack: 'R1' }, { name: 'ACDP2', rack: 'R2' }] });
for (let i = 1; i <= 6; i++) six.sscs.push({ id: 'x' + i, name: 'SSC' + i, rack: i <= 3 ? 'R1' : 'R2', bank: 'k', fans: 2 });
const sp = E.elecLinks(six).filter(l => l.rule === 'ssc-power' && l.cable === 'power-P').map(l => `${l.from.name}.${l.from.port}>${l.to.name}`);
eq(sp, ['ACDP1.SSC1P>SSC1', 'ACDP1.SSC2P>SSC2', 'ACDP1.SSC3P>SSC3', 'ACDP2.SSC1P>SSC4', 'ACDP2.SSC2P>SSC5', 'ACDP2.SSC3P>SSC6'], 'three SSCs per ACDP');
eq(E.elecLinks(six).filter(l => l.rule === 'msm-power').map(l => l.from.name), ['ACDP1', 'ACDP1'], 'the MSM is fed by the first ACDP');
eq(E.elecLinks(six).filter(l => l.rule === 'ac-in').map(l => l.to.name + '.' + l.to.port), ['ACDP1.ACPowerInP', 'ACDP1.ACPowerInB', 'ACDP2.ACPowerInP', 'ACDP2.ACPowerInB'], 'each ACDP takes AC in');
eq(E.elecAcdpsNeeded(six, six.banks[0]), 2, 'six SSCs need two ACDPs');
ok(!E.elecLinks(six).some(l => /B$/.test(l.from.port) && l.from.part === 'msm' && /^SSC/.test(l.from.port)), 'no MSM SSCnB link');

/* sheets 1..n as DWG2527-00: notes x2, then per bank the MSM with ACDP1, the SSC backs ACDP1 feeds,
   ACDP2 and its SSC backs, then the fronts; never more than two SSCs on one sheet (AYK, 24 Nov 2026) */
const sh = E.elecSheets(six);
eq(sh.map(s => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'sheets numbered 1 to n');
eq(sh.map(s => s.kind), ['notes', 'notes', 'msm', 'ssc-back', 'ssc-back', 'acdp', 'ssc-back', 'ssc-back', 'fronts', 'fronts', 'fronts'], 'DWG2527 order');
eq(sh[2].acdp, 'ACDP1', 'the first ACDP is drawn on the MSM sheet');
eq(sh.filter(s => s.kind === 'ssc-back').map(s => s.items.join('+')), ['SSC1+SSC2', 'SSC3', 'SSC4+SSC5', 'SSC6'], 'SSC backs by two, grouped by the ACDP that feeds them');
eq(sh[5].items, ['ACDP2'], 'ACDP2 before the SSCs it feeds');
ok(sh.every(s => s.items.length <= 2), 'at most two SSCs on a sheet');
ok(sh.every(s => s.of === 11), 'every sheet knows the total');
const sh2 = E.elecSheets(two2);
eq(sh2.filter(s => s.kind === 'msm').map(s => s.n), [3, 8], 'banks follow each other');
/* sheet notes: AYK's text until the engineer edits it */
ok(/primary ports/.test(E.elecNote(six, 'comm')), 'notes start as AYK text');
six.notes = { comm: 'Our own note' };
eq(E.elecNote(six, 'comm'), 'Our own note', 'an edited note is used');
six.notes = { comm: '' };
eq(E.elecNote(six, 'comm'), '', 'an emptied note stays empty');
delete six.notes;
ok(E.ELEC_NOTES.filter(n => n.sheet === 1).length >= 5, 'sheet 1 notes are editable');
ok(!links.some(l => /B$/.test(l.from.port) || l.to.port === 'CommB'), 'backup comm ports are not linked by this rule');

/* the part library: ports found on AYK's drawings */
const lib = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../assets/elec/parts.json'), 'utf8'));
const view = (p, v) => lib.parts.find(x => x.id === p).views.find(x => x.id === v);
const names = v => v.ports.map(q => q.name);
eq(lib.parts.map(p => p.id), ['msm', 'ssc', 'jb2', 'jb4', 'acdp', 'module'], 'six parts');
eq(names(view('acdp', 'back')), E.ELEC_ACDP_PORTS, 'ACDP drawing (A2012504): ports in AYK order, left to right');
eq(lib.parts.find(p => p.id === 'jb2').views.map(v => v.id), ['front'], 'junction box: front only');
eq(names(view('jb2', 'front')), ['Bus+', 'Bus-'], '2-connector junction box: Bus+, Bus-');
eq(names(view('jb4', 'front')), ['Bus+', 'Bus-', 'Bus+', 'Bus-'], '4-connector junction box: Bus+, Bus-, Bus+, Bus-');
ok(['jb2', 'jb4'].every(id => view(id, 'front').ports.every(q => q.sure)), 'junction box names confirmed');
const jx = view('jb4', 'front').ports.map(q => q.x);
ok(jx.every((x, i) => !i || x > jx[i - 1]), '4-connector names run left to right');
eq(lib.parts.find(p => p.id === 'module').views.map(v => v.id), ['front'], 'module: front only, no back');
const msm = view('msm', 'back');
eq(msm.ports.length, 39, 'MSM back: 38 connectors + the 19-pin');
for (const nm of ['Cloud', 'EMS', 'PCS', 'Spare', 'Dry Contact', 'Ex.FanFB', 'PowerP', 'PowerB', 'Valve 1', 'Valve 2'])
  ok(msm.ports.find(q => q.name === nm && q.sure), 'MSM ' + nm + ' named for certain');
for (let i = 1; i <= 9; i++) ok(names(msm).includes('SSC' + i + 'P') && names(msm).includes('SSC' + i + 'B') && names(msm).includes('Estop' + i), 'MSM SSC' + i + ' ports');
ok(msm.ports.every(q => q.sure), 'every MSM port name is confirmed');
eq(names(msm).slice(4, 10), ['SSC1P', 'SSC1B', 'SSC2P', 'SSC2B', 'SSC3P', 'SSC3B'], 'SSC jacks row by row, P then B');
eq(names(msm).filter(x => /^(Estop|RemoteE)/.test(x)).slice(-2), ['Estop9', 'RemoteE'], 'RemoteE after Estop9');
eq(msm.ports.find(q => q.name === 'Dry Contact').pins, 2, 'Dry Contact has 2 pins');
eq(msm.ports.filter(q => q.name.startsWith('Valve')).map(q => q.pins), [7, 7], 'valves have 7 pins');
eq(names(view('ssc', 'back')), ['PowerP', 'PowerB', 'CommP', 'CommB', 'Ext-HVIL', 'Cooling Fan', 'Estop', '19-pin connector'], 'SSC back in DWG2527 order');
eq(names(view('ssc', 'front')), ['S', 'N', 'S+', 'B+', 'B-', 'S-'], 'SSC front in AYK order');
const xs = view('ssc', 'back').ports.slice(0, 7).map(q => q.x);
ok(xs.every((x, i) => !i || x > xs[i - 1]), 'SSC back ports run left to right');
ok(E.elecPortBlocked('ssc', view('ssc', 'back').ports[4].name), 'the SSC Ext-HVIL found on the drawing is blocked');

console.log('Electrical setup tests passed: ' + n);
