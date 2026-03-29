'use strict';

const Homey = require('homey');

module.exports = class ZwModuleHeatDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Heat Alarm (ZW-Module) has been initialized');
  }
};
