'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { IASZoneCluster } = require('zigbee-clusters');

/**
 * Centralizes IAS Zone status wiring so Zigbee drivers only define capability mappings instead of cluster plumbing.
 */
class ZigbeeDevice extends ZigBeeDevice {
  /**
   * Defines one reusable IAS listener path so per-driver code focuses on status-to-capability rules.
   *
   * @param {import('zigbee-clusters').ZCLNode} zclNode
   * @param {string[]} capabilityIds
   * @param {(string | ((payload: object) => unknown))[]} statusParsers
   * @param {number} [endpointId]
   * @returns {Promise<void>}
   */
  async registerZoneStatusListener(zclNode, capabilityIds, statusParsers, endpointId) {
    if (statusParsers.length !== capabilityIds.length) {
      throw new Error('Amount of capabilities and flag names should match!');
    }

    const endpoint = endpointId ?? this.getClusterEndpoint(IASZoneCluster) ?? 1;

    const cluster = zclNode.endpoints[endpoint].clusters[IASZoneCluster.NAME];

    cluster.onZoneStatusChangeNotification = async payload => {
      await this._onZoneStatusChangeNotification(payload, capabilityIds, statusParsers);
    };
  }

  /**
   * Isolates capability writes from the cluster callback so listener registration and update logic stay separate.
   *
   * @param {object} payload
   * @param {string[]} capabilityIds
   * @param {(string | ((payload: object) => unknown))[]} statusParsers
   * @returns {Promise<void>}
   */
  async _onZoneStatusChangeNotification(payload, capabilityIds, statusParsers) {
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
  }
}

module.exports = ZigbeeDevice;
