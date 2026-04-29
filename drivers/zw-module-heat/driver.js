'use strict';

const Homey = require('homey');

/**
 * Hosts heat-module driver lifecycle hooks so startup logging remains local to this product variant.
 */
module.exports = class ZwModuleHeatDriver extends Homey.Driver {
  /**
   * Emits a startup log to verify the heat Z-Wave driver initialized successfully.
   */
  async onInit() {
    this.log('Heat Alarm (ZW-Module) has been initialized');
  }
};
