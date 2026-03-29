'use strict';

const Homey = require('homey');

class FireAngelApp extends Homey.App {

  onInit() {
    this.log('FireAngel app has been initialized');

    this._registerFlowCards();
  }

  /**
   * Registers app-level Flow condition cards (see `app.json` / `.homeycompose/flow/conditions`).
   */
  _registerFlowCards() {
    this.homey.flow
      .getConditionCard('inspection_required')
      .registerRunListener(this._booleanCapabilityConditionRunListener.bind(this, 'alarm_maintanance_inspection'));

    this.homey.flow
      .getConditionCard('cleaning_required')
      .registerRunListener(this._booleanCapabilityConditionRunListener.bind(this, 'alarm_maintanance_dust'));

    this.homey.flow
      .getConditionCard('device_should_be_replaced')
      .registerRunListener(this._booleanCapabilityConditionRunListener.bind(this, 'alarm_eol'));
  }

  /**
   * @param {string} capabilityId
   * @param {{ device: Homey.Device }} args
   * @param {object} state
   * @returns {boolean}
   */
  _booleanCapabilityConditionRunListener(capabilityId, args, state) {
    return args.device.getCapabilityValue(capabilityId) === true;
  }

}

module.exports = FireAngelApp;
