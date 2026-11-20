/* Electrical diagram setup: proposals from racks, issues, link kind. */
const assert = require('assert');
const E = require('../js/elec.js');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

/* a new setup answers nothing for the engineer */
const fresh = E.elecNewSetup();
eq(fresh.banks.length, 0, 'no banks');
ok(Object.values(fresh.options).every(v => v === null), 'options unanswered');
ok(!E.elecReady(fresh), 'empty setup is not ready');

/* S10195-like: rack 1 has MSM-1, ACDP2, SSC1-3; rack 2 has SSC4-6 and no MSM */
const parts = [
  { rack: 'Rack 1', kind: 'msm', name: 'MSM-1' }, { rack: 'Rack 1', kind: 'acdp', name: 'ACDP2' },
  { rack: 'Rack 1', kind: 'ssc', name: 'SSC2' }, { rack: 'Rack 1', kind: 'ssc', name: 'SSC1' }, { rack: 'Rack 1', kind: 'ssc', name: 'SSC3' },
  { rack: 'Rack 2', kind: 'ssc', name: 'SSC4' }, { rack: 'Rack 2', kind: 'ssc', name: 'SSC10' }, { rack: 'Rack 2', kind: 'ssc', name: 'SSC5' },
];
const s = E.elecFromRacks(parts, ['Rack 1', 'Rack 2']);
eq(s.banks.length, 1, 'one bank per MSM');
eq(s.banks[0].msm, { name: 'MSM-1', rack: 'Rack 1' }, 'MSM placed');
eq(s.banks[0].acdp, { name: 'ACDP2', rack: 'Rack 1' }, 'ACDP in the MSM rack joins the bank');
eq(s.sscs.map(c => c.name), ['SSC1', 'SSC2', 'SSC3', 'SSC4', 'SSC5', 'SSC10'], 'SSCs in natural order');
eq(s.sscs.filter(c => c.bank).map(c => c.name), ['SSC1', 'SSC2', 'SSC3'], 'only SSCs in the MSM rack are placed');
ok(s.sscs.every(c => c.fans === null), 'fan count is never guessed');
ok(!E.elecReady(s), 'proposal still needs answers');
const msgs = E.elecIssues(s).map(i => i.text).join('\n');
ok(/SSC4: choose its bank/.test(msgs), 'unplaced SSC reported');
ok(/cooling fans/.test(msgs), 'fan count asked');
ok(/master valves/.test(msgs), 'valves asked');

/* answer everything */
for (const c of s.sscs) { c.bank = s.banks[0].id; c.fans = 3; }
for (const k of Object.keys(s.options)) s.options[k] = true;
s.valves = 2;
ok(E.elecReady(s), 'complete setup is ready: ' + E.elecIssues(s).map(i => i.text).join('; '));
const keepAcdp = s.banks[0].acdp; s.banks[0].acdp = { name: '', rack: '' };
ok(E.elecReady(s), 'ACDP is optional');
s.banks[0].acdp = { name: 'ACDP2', rack: '' };
ok(!E.elecReady(s), 'an ACDP that is named needs its rack');
s.banks[0].acdp = keepAcdp;

/* an MSM serves at most 6 SSCs */
s.sscs.push({ id: 'x', name: 'SSC11', rack: 'Rack 2', bank: s.banks[0].id, fans: 2 });
ok(E.elecReady(s), 'the engineer may put more than 6 SSCs on one MSM');
ok(E.elecIssues(s).some(i => i.level === 'note' && /SSC ports 1 to 6/.test(i.text)), '... and it is pointed out');
s.sscs.pop();

/* duplicate names */
s.sscs[1].name = 'SSC1';
ok(/used twice/.test(E.elecIssues(s).map(i => i.text).join()), 'duplicate names caught');
s.sscs[1].name = 'SSC2';

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
ok(E.elecPortBlocked('jb', 'Bus+'), 'no junction box');
ok(!E.elecPortBlocked('ssc', 'PowerP'), 'other SSC ports are wired');
eq(E.ELEC_PARTS, ['msm', 'ssc', 'module'], 'the three part drawings');

/* the part library: ports found on AYK's drawings */
const lib = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../assets/elec/parts.json'), 'utf8'));
const view = (p, v) => lib.parts.find(x => x.id === p).views.find(x => x.id === v);
const names = v => v.ports.map(q => q.name);
eq(lib.parts.map(p => p.id), ['msm', 'ssc', 'module'], 'three parts');
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
