'use strict';

const { ZwaveDevice } = require('homey-zwavedriver');

/**
 * Shared implementation for the smoke and heat Z-Wave drivers so notification decoding and capability
 * mapping are not duplicated per manifest.
 */

/** Maps CC notification type bytes to route keys; strings on the decoded payload are not used here. */
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
 * Maintenance codes differ by host type; keeping both tables here avoids drift between smoke and heat drivers.
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

/** Ids checked together so maintenance decoding runs only when the manifest exposes at least one of them. */
const MAINTENANCE_CAPS = ['alarm_eol', 'alarm_maintanance_inspection', 'alarm_maintanance_dust'];

/**
 * Routing uses the wire type byte from `Notification Type (Raw)`; `Notification Type` is not that byte on decoded payloads.
 *
 * @param {Record<string, unknown> | null | undefined} report
 * @returns {{ type: string, event: number } | null}
 */
function parseNotificationReport(report) {
  if (!report) return null;

  const rawType = report['Notification Type (Raw)'];
  if (!Buffer.isBuffer(rawType) || rawType.length < 1) return null;

  const type = ZW_NOTIFICATION_TYPE[rawType.readUInt8(0)];
  if (!type) return null;

  const event = report.Event;
  if (typeof event !== 'number' || !Number.isFinite(event)) return null;

  return { type, event };
}

/**
 * Stock NOTIFICATION capability parsers do not cover these modules’ multi-capability reports; one handler maps each report to every relevant cap.
 */
class ZWaveDevice extends ZwaveDevice {
  /**
   * `BATTERY` maps cleanly through `registerCapability`; NOTIFICATION alarm routing lives in this class, so it is subscribed here instead.
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
   * Single handler so related capabilities update from the same parsed `{ type, event }` without overlapping parsers.
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
   * Ignores unknown event codes so unrelated notifications do not flip the capability off or on by mistake.
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
   * The module reports one maintenance condition per notification; all three caps are written together to stay consistent with that.
   *
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
