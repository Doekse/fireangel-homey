'use strict';

const ZigbeeDevice = require('../../lib/ZigbeeDevice');

/** Time to keep `alarm_test` true after the IAS test bit clears (ms). */
const ALARM_TEST_HOLD_MS = 8000;

/**
 * FireAngel ZB module: maps IAS Zone status bits (after stack enrollment) to `alarm_fire`, tamper, test,
 * hardware problem, and low-battery (`battery` map bit). Uses `alarm_fire` so smoke- and heat-head
 * combinations share one capability.
 */
class ZbModule extends ZigbeeDevice {
  /**
   * @param {object} payload
   * @param {import('zigbee-clusters').ZCLNode} payload.zclNode
   * @returns {Promise<void>}
   */
  async onNodeInit(payload) {
    await super.onNodeInit(payload);
    const { zclNode } = payload;

    await this.registerZoneStatusListener(
      zclNode,
      ['alarm_fire', 'alarm_tamper', 'alarm_test', 'alarm_problem', 'alarm_battery'],
      [
        payload => {
          const flags = payload.zoneStatus.getBits();
          return flags.includes('alarm1') || flags.includes('alarm2');
        },
        payload => {
          const flags = payload.zoneStatus.getBits();
          return flags.includes('tamper');
        },
        payload => this._alarmTestFromZoneStatus(payload),
        payload => {
          const flags = payload.zoneStatus.getBits();
          return flags.includes('trouble') || flags.includes('batteryDefect');
        },
        'battery',
      ],
    );
  }

  /**
   * Derives `alarm_test` from the IAS test bit but holds `true` for {@link ALARM_TEST_HOLD_MS} after the
   * bit drops so short test pulses remain visible to Homey.
   *
   * @param {object} payload
   * @returns {Promise<boolean>}
   */
  async _alarmTestFromZoneStatus(payload) {
    const flags = payload.zoneStatus.getBits();
    if (flags.includes('test')) {
      if (this._alarmTestClearTimer != null) {
        this.homey.clearTimeout(this._alarmTestClearTimer);
        this._alarmTestClearTimer = null;
      }
      return true;
    }
    const holding =
      this.getCapabilityValue('alarm_test') === true || this._alarmTestClearTimer != null;
    if (!holding) {
      return false;
    }
    if (this._alarmTestClearTimer == null) {
      this._alarmTestClearTimer = this.homey.setTimeout(() => {
        this._alarmTestClearTimer = null;
        this.setCapabilityValue('alarm_test', false).catch(this.error);
      }, ALARM_TEST_HOLD_MS);
    }
    return true;
  }

  /**
   * @returns {Promise<void>}
   */
  async onUninit() {
    if (this._alarmTestClearTimer != null) {
      this.homey.clearTimeout(this._alarmTestClearTimer);
      this._alarmTestClearTimer = null;
    }
    await super.onUninit();
    this.log('Device successfully uninitialized');
  }
}

module.exports = ZbModule;
