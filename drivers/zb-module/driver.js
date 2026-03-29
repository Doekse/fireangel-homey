'use strict';

const { ZigBeeDriver } = require('homey-zigbeedriver');

/**
 * Zigbee driver for the FireAngel ZB-Module (IAS Zone smoke/heat alarm head).
 */
module.exports = class ZbModuleDriver extends ZigBeeDriver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('ZB-Module driver has been initialized');
  }
};
