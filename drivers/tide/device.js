'use strict';

const { Device } = require('homey');
const Tide = require('./../../source/tide.js');

class MyDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    const settings = this.getSettings();
    if (settings.latitude) {
      this.latitude = parseFloat(settings.latitude);
    } else {
      this.latitude = this.homey.geolocation.getLatitude()
    }
    if (settings.longitude) {
      this.longitude = parseFloat(settings.longitude);
    } else {
      this.longitude = this.homey.geolocation.getLongitude();
    }

    this.tide = new Tide(this.homey, this.latitude, this.longitude); 
    await this.tide.updateSealevel();

    this.updateInterval = this.homey.setInterval(async () => {
      this.tide.updateSealevel();
    }, 1800000);
    
    this.checkInterval = this.homey.setInterval(async () => {
      this.tide.checkForEvents();

      this.tide.processCurrentTide((currentValues) => {
        this.setCapabilityValue('tideLevel', currentValues.tideLevel).catch(this.error);
        this.setCapabilityValue('tideChangeLong', currentValues.tideChangeNextHour).catch(this.error);
        this.setCapabilityValue('tideChangeShort', currentValues.tideChangeNext10Min).catch(this.error);
        this.setCapabilityValue('tideNextType', currentValues.tideNextType).catch(this.error);
        this.setCapabilityValue('tideNextTime', currentValues.tideNextTime).catch(this.error);
      });
    }, 5000);

    this.homey.flow.getConditionCard('isTideHigh').registerRunListener(async (args, state) => { 
      return this.tide.isTideHigh();
    });

    this.homey.flow.getConditionCard('isTideLow').registerRunListener(async (args, state) => { 
      return this.tide.isTideLow();
    });

    this.homey.flow.getConditionCard('isTideFalling').registerRunListener(async (args, state) => { 
      return this.tide.isTideFalling();
    });

    this.homey.flow.getConditionCard('isTideRising').registerRunListener(async (args, state) => { 
      return this.tide.isTideRising();
    });

    const tideHighestTrigger = this.homey.flow.getDeviceTriggerCard('whenTideHighest');
    tideHighestTrigger.registerRunListener(async (args, state) => {
      return true;
    });

    const tideLowestTrigger = this.homey.flow.getDeviceTriggerCard('whenTideLowest');
    tideLowestTrigger.registerRunListener(async (args, state) => {
      return true;
    });

    this.tide.eventEmitter.on('highest', async (event) => {
      await tideHighestTrigger.trigger(this);
    });

    this.tide.eventEmitter.on('lowest', async (event) => {
      await tideLowestTrigger.trigger(this);
    });

    this.log('MyDevice has been initialized');
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    
    this.log('MyDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (newSettings.latitude) {
      this.latitude = parseFloat(newSettings.latitude);
    } else {
      this.latitude = this.homey.geolocation.getLatitude()
    }
    if (newSettings.longitude) {
      this.longitude = parseFloat(newSettings.longitude);
    } else {
      this.longitude = this.homey.geolocation.getLongitude()
    }

    this.tide.updatePosition(this.latitude, this.longitude);
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('MyDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.homey.clearInterval(this.updateInterval);
    this.homey.clearInterval(this.checkInterval);
    this.log('MyDevice has been deleted');
  }

}

module.exports = MyDevice;
