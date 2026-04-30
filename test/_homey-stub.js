'use strict';

/**
 * Minimal stub for the `homey` module. The Homey runtime injects `homey` as a built-in;
 * outside of it, `homey-zwavedriver` (and `homey-zigbeedriver`) fail to load because they
 * `require('homey')` to extend `Homey.Device` at class declaration time.
 *
 * We only need the class to exist — tests never instantiate the Homey side. They invoke
 * the ZWaveDevice prototype methods directly via `.call(fakeDevice, …)`.
 */

class Device {}
class App {}
class Driver {}

module.exports = { Device, App, Driver };
