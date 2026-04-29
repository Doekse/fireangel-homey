'use strict';

const { ZwaveDevice } = require('homey-zwavedriver');

/**
 * Centralizes FireAngel Z-Wave notification decoding so smoke and heat variants stay behaviorally aligned.
 */

/** Keeps raw notification-type bytes mapped to shared lookup keys used by test and maintenance handlers. */
const ZW_NOTIFICATION_TYPE = {
  1: 'smoke',
  4: 'heat',
  9: 'system',
};

const IDLE = new Set([0]);
const SMOKE_ALARM_EVENTS = new Set([1, 2]);
const HARDWARE_FAILURE = new Set([1]);
const TAMPER = new Set([6]);

const TEST_ACTIVE_EVENTS = {
  smoke: new Set([3]),
  heat: new Set([7]),
};

/**
 * Encodes module-manual maintenance events once so both variants share the same eol/inspection/dust mapping.
 */
const MAINTENANCE_EVENT_ROWS = {
  smoke: [
    [[5], [true, false, false]],
    [[7], [false, true, false]],
    [[8], [false, false, true]],
  ],
  heat: [
    [[8], [true, false, false]],
    [[11], [false, true, false]],
    [[12], [false, false, true]],
  ],
};

const MAINTENANCE_CAPS = ['alarm_eol', 'alarm_maintanance_inspection', 'alarm_maintanance_dust'];

/**
 * @param {Record<string, unknown> | null | undefined} report
 * @returns {{ type: string, event: number } | null}
 */
function parseNotificationReport(report) {
  if (!report) return null;

  const rawType = report['Notification Type'];
  const typeByte =
    typeof rawType === 'number' && Number.isFinite(rawType)
      ? rawType
      : Number.parseInt(String(rawType ?? '').trim(), 10);
  if (Number.isNaN(typeByte)) return null;

  const type = ZW_NOTIFICATION_TYPE[typeByte];
  if (!type) return null;

  const rawEvent = report.Event;
  const event =
    typeof rawEvent === 'number' && Number.isFinite(rawEvent)
      ? rawEvent
      : Number.parseInt(String(rawEvent ?? '').trim(), 10);
  if (Number.isNaN(event)) return null;

  return { type, event };
}

/**
 * Provides one notification pipeline while letting driver manifests decide which capabilities are exposed.
 */
class ZWaveDevice extends ZwaveDevice {
  /**
   * Installs report listeners during node init so capability updates are driven by incoming notifications.
   *
   * @returns {void}
   */
  onNodeInit() {
    if (this.hasCapability('measure_battery')) {
      this.registerCapability('measure_battery', 'BATTERY');
    }

    this.registerReportListener(
      'NOTIFICATION',
      'NOTIFICATION_REPORT',
      report => this._onNotificationReport(report),
    );
  }

  /**
   * Keeps notification parsing and capability updates in one path so event handling remains deterministic.
   *
   * @param {Record<string, unknown> | null | undefined} report
   * @returns {Promise<void>}
   */
  async _onNotificationReport(report) {
    const parsed = parseNotificationReport(report);
    if (!parsed) return;

    const { type, event } = parsed;

    if (type === 'system') {
      await this._setBoolFromEvent('alarm_problem', event, HARDWARE_FAILURE);
      await this._setBoolFromEvent('alarm_tamper', event, TAMPER);
      return;
    }

    if (this.hasCapability('alarm_test')) {
      const testOn = TEST_ACTIVE_EVENTS[type];
      if (testOn && (testOn.has(event) || IDLE.has(event))) {
        await this.setCapabilityValue('alarm_test', testOn.has(event)).catch(this.error);
      }
    }

    if (MAINTENANCE_CAPS.some(c => this.hasCapability(c))) {
      const rows = MAINTENANCE_EVENT_ROWS[type];
      if (rows) {
        if (IDLE.has(event)) {
          await this._setMaintenanceFlags(false, false, false);
        } else {
          for (const [codes, triple] of rows) {
            if (codes.includes(event)) {
              const [eol, inspection, dust] = triple;
              await this._setMaintenanceFlags(eol, inspection, dust);
              break;
            }
          }
        }
      }
    }

    let mainAlarm;
    if (SMOKE_ALARM_EVENTS.has(event)) mainAlarm = true;
    else if (IDLE.has(event)) mainAlarm = false;
    else return;

    const cap = type === 'smoke' ? 'alarm_smoke' : 'alarm_heat';
    if (this.hasCapability(cap)) {
      await this.setCapabilityValue(cap, mainAlarm).catch(this.error);
    }
  }

  /**
   * Active event codes → true, idle (0) → false; other events leave the capability unchanged.
   *
   * @param {string} capabilityId
   * @param {number} event
   * @param {Set<number>} activeEvents
   * @returns {Promise<void>}
   */
  async _setBoolFromEvent(capabilityId, event, activeEvents) {
    if (!this.hasCapability(capabilityId)) return;
    if (!activeEvents.has(event) && !IDLE.has(event)) return;
    await this.setCapabilityValue(capabilityId, activeEvents.has(event)).catch(this.error);
  }

  /**
   * @param {boolean} eol
   * @param {boolean} inspection
   * @param {boolean} dust
   * @returns {Promise<void>}
   */
  async _setMaintenanceFlags(eol, inspection, dust) {
    const pairs = [
      ['alarm_eol', eol],
      ['alarm_maintanance_inspection', inspection],
      ['alarm_maintanance_dust', dust],
    ];
    for (const [id, value] of pairs) {
      if (this.hasCapability(id)) {
        await this.setCapabilityValue(id, value).catch(this.error);
      }
    }
  }
}

module.exports = ZWaveDevice;
