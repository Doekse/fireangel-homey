'use strict';

const Homey = require('homey');

module.exports = class ZwModuleSmokeDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Smoke Alarm (ZW-Module) has been initialized');
  }
};
