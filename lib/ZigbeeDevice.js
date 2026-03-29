'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { IASZoneCluster } = require('zigbee-clusters');

/** Persists the CIE-assigned IAS Zone id so every init sends the same `zoneId` in `zoneEnrollResponse`. */
const IAS_ZONE_ZONE_ID_STORE_KEY = 'iasZoneZoneId';

/**
 * Shared FireAngel Zigbee base: {@link ZigbeeDevice#initIasZoneDevice} mirrors the Drenso
 * `initIasZoneDevice` helper (IAS Zone enroll + zone status → capabilities).
 */
class ZigbeeDevice extends ZigBeeDevice {
  /**
   * IAS Zone client: enroll listener, optional proactive `zoneEnrollResponse`, and
   * `zoneStatusChangeNotification` mapped through `capabilityIds` / `statusParsers`.
   * `zoneId` is stored on the device so restarts and repairs keep using the same id (random each init
   * can leave the sensor stuck not enrolled).
   *
   * @param {import('zigbee-clusters').ZCLNode} zclNode
   * @param {string[]} capabilityIds
   * @param {(string | ((payload: object) => unknown))[]} statusParsers
   * @param {number} [endpointId]
   * @param {boolean} [autoEnrollResponse]
   * @returns {Promise<void>}
   */
  async initIasZoneDevice(zclNode, capabilityIds, statusParsers, endpointId, autoEnrollResponse) {
    if (statusParsers.length !== capabilityIds.length) {
      throw new Error('Amount of capabilities and flag names should match!');
    }

    const endpoint = endpointId ?? this.getClusterEndpoint(IASZoneCluster) ?? 1;

    this.log(`Initialising IasZone on endpoint ${endpoint}`);

    const cluster = zclNode.endpoints[endpoint].clusters[IASZoneCluster.NAME];

    let zoneId = this.getStoreValue(IAS_ZONE_ZONE_ID_STORE_KEY);
    if (typeof zoneId !== 'number' || !Number.isInteger(zoneId) || zoneId < 1 || zoneId > 254) {
      zoneId = 1 + Math.floor(Math.random() * 254);
      await this.setStoreValue(IAS_ZONE_ZONE_ID_STORE_KEY, zoneId);
    }

    /**
     * @param {'proactive' | 'zoneEnrollRequest'} source
     * @returns {void}
     */
    const sendZoneEnrollResponse = source => {
      cluster
        .zoneEnrollResponse({ enrollResponseCode: 'success', zoneId }, { waitForResponse: false })
        .then(() => {
          this.log(`zoneEnrollResponse completed (${source}), zoneId=${zoneId}`);
        })
        .catch(e => this.error('Failed to write zoneEnrollResponse', e));
    };

    cluster.onZoneEnrollRequest = payload => {
      this.log('Zone enroll request received', payload);
      sendZoneEnrollResponse('zoneEnrollRequest');
    };

    if (autoEnrollResponse) {
      this.log('Automatically sending zone enroll response');
      sendZoneEnrollResponse('proactive');
    }

    cluster.onZoneStatusChangeNotification = async payload => {
      const flags = payload.zoneStatus.getBits();

      for (let i = 0; i < capabilityIds.length; i++) {
        const capabilityId = capabilityIds[i];
        const statusParser = statusParsers[i];
        if (typeof statusParser == 'string') {
          await this.setCapabilityValue(capabilityId, flags.includes(statusParser));
        } else {
          await this.setCapabilityValue(capabilityId, await statusParser(payload));
        }
      }
    };

    this.log(`IasZone setup finished (endpoint ${endpoint})`);
  }
}

module.exports = ZigbeeDevice;
