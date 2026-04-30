'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const HOMEY_STUB = path.join(__dirname, '_homey-stub.js');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
  if (request === 'homey') return HOMEY_STUB;
  return originalResolve.call(this, request, parent, ...rest);
};

const ZWaveDevice = require('../lib/ZWaveDevice');
const { parseNotificationReport } = ZWaveDevice;

/**
 * @param {number} typeByte
 * @param {number} event
 * @returns {Record<string, unknown>}
 */
function report(typeByte, event) {
  return {
    'Notification Type': typeByte === 1 ? 'Smoke' : typeByte === 4 ? 'Heat' : typeByte === 9 ? 'System' : 'Unknown',
    'Notification Type (Raw)': Buffer.from([typeByte]),
    Event: event,
  };
}

/**
 * @param {string[]} capabilityIds
 */
function makeFake(capabilityIds) {
  const caps = new Set(capabilityIds);
  const calls = new Map();
  return {
    hasCapability: id => caps.has(id),
    setCapabilityValue: (id, value) => {
      calls.set(id, value);
      return Promise.resolve();
    },
    error: () => {},
    _setBoolFromEvent: ZWaveDevice.prototype._setBoolFromEvent,
    _setMaintenanceFlags: ZWaveDevice.prototype._setMaintenanceFlags,
    _calls: calls,
  };
}

/**
 * @param {object} fake
 * @param {Record<string, unknown>} r
 */
function dispatch(fake, r) {
  return ZWaveDevice.prototype._onNotificationReport.call(fake, r);
}

test('parseNotificationReport: smoke alarm with string label and Buffer raw', () => {
  const parsed = parseNotificationReport(report(0x01, 1));
  assert.deepEqual(parsed, { type: 'smoke', event: 1 });
});

test('parseNotificationReport: heat idle (event 0)', () => {
  const parsed = parseNotificationReport(report(0x04, 0));
  assert.deepEqual(parsed, { type: 'heat', event: 0 });
});

test('parseNotificationReport: system tamper', () => {
  const parsed = parseNotificationReport(report(0x09, 6));
  assert.deepEqual(parsed, { type: 'system', event: 6 });
});

test('parseNotificationReport: missing raw buffer returns null', () => {
  assert.equal(parseNotificationReport({ 'Notification Type': 'Smoke', Event: 1 }), null);
});

test('parseNotificationReport: non-buffer raw returns null', () => {
  assert.equal(
    parseNotificationReport({ 'Notification Type (Raw)': 1, Event: 1 }),
    null,
  );
});

test('parseNotificationReport: empty buffer returns null', () => {
  assert.equal(
    parseNotificationReport({ 'Notification Type (Raw)': Buffer.alloc(0), Event: 1 }),
    null,
  );
});

test('parseNotificationReport: unknown type byte returns null', () => {
  assert.equal(parseNotificationReport(report(0xFF, 1)), null);
});

test('parseNotificationReport: missing event returns null', () => {
  assert.equal(
    parseNotificationReport({ 'Notification Type (Raw)': Buffer.from([0x01]) }),
    null,
  );
});

test('parseNotificationReport: non-numeric event returns null', () => {
  assert.equal(
    parseNotificationReport({
      'Notification Type (Raw)': Buffer.from([0x01]),
      Event: 'nope',
    }),
    null,
  );
});

test('parseNotificationReport: null/undefined report returns null', () => {
  assert.equal(parseNotificationReport(null), null);
  assert.equal(parseNotificationReport(undefined), null);
});

test('dispatch: ST-630 fire alarm sets alarm_smoke=true', async () => {
  const fake = makeFake(['alarm_smoke', 'alarm_test', 'alarm_eol']);
  await dispatch(fake, report(0x01, 1));
  assert.equal(fake._calls.get('alarm_smoke'), true);
  assert.equal(fake._calls.has('alarm_test'), false);
});

test('dispatch: ST-630 idle clears smoke + test + maintenance', async () => {
  const fake = makeFake([
    'alarm_smoke',
    'alarm_test',
    'alarm_eol',
    'alarm_maintanance_inspection',
    'alarm_maintanance_dust',
  ]);
  await dispatch(fake, report(0x01, 0));
  assert.equal(fake._calls.get('alarm_smoke'), false);
  assert.equal(fake._calls.get('alarm_test'), false);
  assert.equal(fake._calls.get('alarm_eol'), false);
  assert.equal(fake._calls.get('alarm_maintanance_inspection'), false);
  assert.equal(fake._calls.get('alarm_maintanance_dust'), false);
});

test('dispatch: ST-630 test pulse sets alarm_test=true, leaves alarm_smoke', async () => {
  const fake = makeFake(['alarm_smoke', 'alarm_test']);
  await dispatch(fake, report(0x01, 3));
  assert.equal(fake._calls.get('alarm_test'), true);
  assert.equal(fake._calls.has('alarm_smoke'), false);
});

test('dispatch: ST-630 EOL (smoke event 5) sets alarm_eol=true', async () => {
  const fake = makeFake(['alarm_smoke', 'alarm_eol', 'alarm_maintanance_inspection', 'alarm_maintanance_dust']);
  await dispatch(fake, report(0x01, 5));
  assert.equal(fake._calls.get('alarm_eol'), true);
  assert.equal(fake._calls.get('alarm_maintanance_inspection'), false);
  assert.equal(fake._calls.get('alarm_maintanance_dust'), false);
  assert.equal(fake._calls.has('alarm_smoke'), false);
});

test('dispatch: HT-630 heat alarm sets alarm_heat=true', async () => {
  const fake = makeFake(['alarm_heat', 'alarm_test']);
  await dispatch(fake, report(0x04, 2));
  assert.equal(fake._calls.get('alarm_heat'), true);
});

test('dispatch: HT-630 EOL (heat event 8) sets alarm_eol=true (heat byte differs from smoke)', async () => {
  const fake = makeFake(['alarm_heat', 'alarm_eol', 'alarm_maintanance_inspection', 'alarm_maintanance_dust']);
  await dispatch(fake, report(0x04, 8));
  assert.equal(fake._calls.get('alarm_eol'), true);
  assert.equal(fake._calls.get('alarm_maintanance_inspection'), false);
  assert.equal(fake._calls.has('alarm_heat'), false);
});

test('dispatch: System tamper sets alarm_tamper, no smoke/heat dispatch', async () => {
  const fake = makeFake(['alarm_tamper', 'alarm_problem', 'alarm_smoke', 'alarm_heat']);
  await dispatch(fake, report(0x09, 6));
  assert.equal(fake._calls.get('alarm_tamper'), true);
  assert.equal(fake._calls.has('alarm_smoke'), false);
  assert.equal(fake._calls.has('alarm_heat'), false);
});

test('dispatch: System hardware failure sets alarm_problem, leaves alarm_tamper untouched', async () => {
  const fake = makeFake(['alarm_problem', 'alarm_tamper']);
  await dispatch(fake, report(0x09, 1));
  assert.equal(fake._calls.get('alarm_problem'), true);
  // event 1 is neither in TAMPER ({6}) nor IDLE ({0}); _setBoolFromEvent doesn't touch alarm_tamper.
  assert.equal(fake._calls.has('alarm_tamper'), false);
});

test('dispatch: System idle (event 0) clears both alarm_problem and alarm_tamper', async () => {
  const fake = makeFake(['alarm_problem', 'alarm_tamper']);
  await dispatch(fake, report(0x09, 0));
  assert.equal(fake._calls.get('alarm_problem'), false);
  assert.equal(fake._calls.get('alarm_tamper'), false);
});

test('dispatch: unknown type byte writes nothing', async () => {
  const fake = makeFake(['alarm_smoke', 'alarm_heat', 'alarm_test']);
  await dispatch(fake, report(0xFF, 1));
  assert.equal(fake._calls.size, 0);
});

test('dispatch: heat report on smoke-only fake writes nothing', async () => {
  const fake = makeFake(['alarm_smoke']);
  await dispatch(fake, report(0x04, 2));
  assert.equal(fake._calls.size, 0);
});
