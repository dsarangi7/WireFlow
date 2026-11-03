const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '../js/app.js'), 'utf8');
const code = source.slice(source.indexOf('function validateStudioSvg('), source.indexOf('/* ================= PROJECT WORKSPACE'));
let nodes = [];
let malformed = false;
class Parser {
  parseFromString() {
    return { documentElement: { localName: 'svg' }, querySelector: () => malformed, querySelectorAll: () => nodes };
  }
}
class Serializer { serializeToString() { return '<svg/>'; } }
const validate = vm.runInNewContext(code + '\nvalidateStudioSvg', { DOMParser: Parser, XMLSerializer: Serializer });
assert.strictEqual(validate('<svg/>'), '<svg/>');
assert.strictEqual(validate('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://example.test/svg.dtd"><svg/>'), '<svg/>');
assert.throws(() => validate('<!DOCTYPE svg [<!ENTITY x "test">]><svg/>'), /declarations/);
assert.throws(() => validate('<?xml-stylesheet href="x"?><svg/>'), /declarations/);
malformed = true;
assert.throws(() => validate('<svg>'), /malformed/);
malformed = false;
nodes = [{ localName: 'script', attributes: [] }];
assert.throws(() => validate('<svg/>'), /active content/);
nodes = [{ localName: 'image', attributes: [{ localName: 'href', value: 'https://example.com/a.png' }] }];
assert.throws(() => validate('<svg/>'), /external resource/);
nodes = [{ localName: 'path', attributes: [{ localName: 'onclick', value: 'x()' }] }];
assert.throws(() => validate('<svg/>'), /active or external/);
nodes = [{ localName: 'use', attributes: [{ localName: 'href', value: '#part' }] }];
assert.strictEqual(validate('<svg/>'), '<svg/>');
console.log('SVG import boundary checks passed.');
const sessionCode = source.slice(source.indexOf('function validateStudioSession('), source.indexOf('async function saveStudioSession('));
const validateSession = vm.runInNewContext(sessionCode + '\nvalidateStudioSession');
assert.strictEqual(validateSession({ format: 'ayk-wireflow-session', version: 1, project: { config: {} }, svg: '<svg/>' }), true);
assert.throws(() => validateSession({ format: 'ayk-wireflow-session', version: 2, project: { config: {} }, svg: '<svg/>' }), /not a supported/);
assert.throws(() => validateSession({ format: 'ayk-wireflow-session', version: 1, project: { config: [] }, svg: '<svg/>' }), /not a supported/);
console.log('Session format checks passed.');
