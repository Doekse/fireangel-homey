'use strict';

const { ZwaveDevice } = require('homey-zwavedriver');

const NOTIFICATION_TYPES = {
  SMOKE: 'smoke',
  HEAT: 'heat',
  SYSTEM: 'system',
};

const IDLE = new Set([0]);
const SMOKE_ALARM_EVENTS = new Set([1, 2]);
const HARDWARE_FAILURE = new Set([1]);
const TAMPER = new Set([6]);

/** ST-630 smoke test (0x03); HT-630 heat test (0x07). */
const TEST_EVENTS = {
  smoke: new Set([3]),
  heat: new Set([7]),
};

/**
 * Event IDs per notification type; smoke and heat use different hex for the
 * same labels (FireAngel module manual).
 */
const MAINTENANCE = {
  smoke: {
    eol: new Set([5]),
    inspection: new Set([7]),
    dust: new Set([8]),
  },
  heat: {
    eol: new Set([8]),
    inspection: new Set([11]),
    dust: new Set([12]),
  },
};

/**
 * @param {unknown} value Raw Z-Wave notification type value.
 * @returns {string|null} Internal type key or null.
 */
function normalizeNotificationType(value) {
  const s = String(value ?? '').trim().toLowerCase();

  if (s === '1' || s.includes('smoke')) return NOTIFICATION_TYPES.SMOKE;
  if (s === '4' || s.includes('heat')) return NOTIFICATION_TYPES.HEAT;
  if (s === '9' || s.includes('system')) return NOTIFICATION_TYPES.SYSTEM;

  return null;
}

/**
 * @param {unknown} value Raw notification event value.
 * @returns {number|null}
 */
function normalizeEvent(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Shared FireAngel Z-Wave module device; driver manifests choose capabilities.
 */
class ZWaveDevice extends ZwaveDevice {
  /**
   * Registers Z-Wave capability bindings and the notification report listener.
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
      report => this.onNotificationReport(report),
    );
  }

  /**
   * Handles `NOTIFICATION_REPORT` from `COMMAND_CLASS_NOTIFICATION` (Z-Wave → Homey).
   *
   * @param {Record<string, unknown> | null | undefined} report
   * @returns {Promise<void>}
   */
  async onNotificationReport(report) {
    if (!report) return;

    const type = normalizeNotificationType(
      report['Notification Type'] ?? report['NotificationType'],
    );
    const event = normalizeEvent(report.Event);
    if (!type || event === null) return;

    if (type === NOTIFICATION_TYPES.SYSTEM) {
      await this.setNotificationSystemCapabilities(event);
      return;
    }

    await this.setNotificationTestCapabilities(type, event);
    await this.setNotificationMaintenanceCapabilities(type, event);

    const mainAlarm = SMOKE_ALARM_EVENTS.has(event)
      ? true
      : IDLE.has(event)
        ? false
        : null;
    if (mainAlarm === null) return;

    const cap = type === NOTIFICATION_TYPES.SMOKE ? 'alarm_smoke' : 'alarm_heat';
    if (this.hasCapability(cap)) {
      await this.setCapabilityValue(cap, mainAlarm).catch(this.error);
    }
  }

  /**
   * Sets `alarm_problem` and `alarm_tamper` from System notification type (0x09) events.
   *
   * @param {number} event
   * @returns {Promise<void>}
   */
  async setNotificationSystemCapabilities(event) {
    await this.setCapabilityValueForActiveOrIdleEvent('alarm_problem', event, HARDWARE_FAILURE);
    await this.setCapabilityValueForActiveOrIdleEvent('alarm_tamper', event, TAMPER);
  }

  /**
   * Sets `alarm_test` from smoke/heat test notification events.
   *
   * @param {string} type Normalized notification type.
   * @param {number} event
   * @returns {Promise<void>}
   */
  async setNotificationTestCapabilities(type, event) {
    if (!this.hasCapability('alarm_test')) return;

    const kind = type === NOTIFICATION_TYPES.SMOKE ? 'smoke' : 'heat';
    const active = TEST_EVENTS[kind];
    if (!active.has(event) && !IDLE.has(event)) return;

    await this.setCapabilityValue('alarm_test', active.has(event)).catch(this.error);
  }

  /**
   * Sets EOL / inspection / dust capabilities from maintenance notification events.
   *
   * @param {string} type Normalized notification type.
   * @param {number} event
   * @returns {Promise<void>}
   */
  async setNotificationMaintenanceCapabilities(type, event) {
    const kind = type === NOTIFICATION_TYPES.SMOKE ? 'smoke' : 'heat';
    const cfg = MAINTENANCE[kind];
    if (!cfg) return;

    const hasAny = ['alarm_eol', 'alarm_maintanance_inspection', 'alarm_maintanance_dust']
      .some(c => this.hasCapability(c));
    if (!hasAny) return;

    if (IDLE.has(event)) {
      await this.setMaintenanceCapabilityValues(false, false, false);
      return;
    }

    if (cfg.eol.has(event)) {
      await this.setMaintenanceCapabilityValues(true, false, false);
      return;
    }
    if (cfg.inspection.has(event)) {
      await this.setMaintenanceCapabilityValues(false, true, false);
      return;
    }
    if (cfg.dust.has(event)) {
      await this.setMaintenanceCapabilityValues(false, false, true);
    }
  }

  /**
   * Sets a boolean capability from notification state: active event codes → true,
   * idle (0) → false (same idea as `Device#setCapabilityValue` for booleans).
   *
   * @param {string} capabilityId
   * @param {number} event
   * @param {Set<number>} activeEvents
   * @returns {Promise<void>}
   */
  async setCapabilityValueForActiveOrIdleEvent(capabilityId, event, activeEvents) {
    if (!this.hasCapability(capabilityId)) return;
    if (!activeEvents.has(event) && !IDLE.has(event)) return;

    await this.setCapabilityValue(capabilityId, activeEvents.has(event)).catch(this.error);
  }

  /**
   * At most one of EOL / inspection / dust true per update (device sends one condition per report).
   *
   * @param {boolean} eol
   * @param {boolean} inspection
   * @param {boolean} dust
   * @returns {Promise<void>}
   */
  async setMaintenanceCapabilityValues(eol, inspection, dust) {
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
