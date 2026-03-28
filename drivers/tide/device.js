'use strict';

const { Device } = require('homey');
const Tide = require('./../../source/tide.js');

class MyDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.logger = async (data) => {
      this.homey.app.logger(`${this.getName()}: ${data}`);
    };

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

    // Ensure new capabilities are registered for existing devices
    const newCapabilities = ['tideNextHighTime', 'tideNextHighLevel', 'tideNextLowTime', 'tideNextLowLevel'];
    for (const cap of newCapabilities) {
      if (!this.hasCapability(cap)) {
        await this.addCapability(cap).catch(this.error);
      }
    }

    this.tide = new Tide(this.homey, this.latitude, this.longitude); 
    this.tide.setLogger(this.logger);
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

        // Check threshold triggers with hysteresis (2 cm deadband)
        if (currentValues.tideLevel !== null) {
          this._checkThresholdTriggers(currentValues.tideLevel);
        }
      });

      // Update forecast capabilities
      this._updateForecastCapabilities();
    }, 5000);

    // Existing condition cards
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

    // Threshold condition cards
    this.homey.flow.getConditionCard('isTideLevelAbove').registerRunListener(async (args, state) => {
      const level = this.tide.getCurrentLevel();
      if (level === null) return false;
      return level > args.level;
    });

    this.homey.flow.getConditionCard('isTideLevelBelow').registerRunListener(async (args, state) => {
      const level = this.tide.getCurrentLevel();
      if (level === null) return false;
      return level < args.level;
    });

    // Existing trigger cards
    const tideHighestTrigger = this.homey.flow.getDeviceTriggerCard('whenTideHighest');
    tideHighestTrigger.registerRunListener(async (args, state) => {
      return true;
    });

    const tideLowestTrigger = this.homey.flow.getDeviceTriggerCard('whenTideLowest');
    tideLowestTrigger.registerRunListener(async (args, state) => {
      return true;
    });

    // Threshold trigger cards - only fire when level crosses the threshold
    const tideLevelAboveTrigger = this.homey.flow.getDeviceTriggerCard('whenTideLevelAbove');
    tideLevelAboveTrigger.registerRunListener(async (args, state) => {
      return state.previousLevel < args.level && state.currentLevel >= args.level;
    });

    const tideLevelBelowTrigger = this.homey.flow.getDeviceTriggerCard('whenTideLevelBelow');
    tideLevelBelowTrigger.registerRunListener(async (args, state) => {
      return state.previousLevel > args.level && state.currentLevel <= args.level;
    });

    this._tideLevelAboveTrigger = tideLevelAboveTrigger;
    this._tideLevelBelowTrigger = tideLevelBelowTrigger;

    this.tide.eventEmitter.on('highest', async (event) => {
      await tideHighestTrigger.trigger(this);
    });

    this.tide.eventEmitter.on('lowest', async (event) => {
      await tideLowestTrigger.trigger(this);
    });

    this.logger('Device has been initialized');
  }

  _checkThresholdTriggers(currentLevel) {
    if (this._lastLevel === undefined || this._lastLevel === null) {
      this._lastLevel = currentLevel;
      return;
    }

    // Only fire when the level actually crosses a threshold boundary
    // Pass both previous and current level so the runListener can check crossing
    if (currentLevel !== this._lastLevel) {
      this._tideLevelAboveTrigger.trigger(this, {}, {
        currentLevel,
        previousLevel: this._lastLevel,
      }).catch(this.error);
      this._tideLevelBelowTrigger.trigger(this, {}, {
        currentLevel,
        previousLevel: this._lastLevel,
      }).catch(this.error);
    }

    this._lastLevel = currentLevel;
  }

  _updateForecastCapabilities() {
    const nextHigh = this.tide.getNextHighTide();
    const nextLow = this.tide.getNextLowTide();

    if (nextHigh) {
      const formattedTime = nextHigh.timestamp.toLocaleTimeString('nb', {
        timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit',
      });
      this.setCapabilityValue('tideNextHighTime', formattedTime).catch(this.error);
      if (!Number.isNaN(nextHigh.tideLevel)) {
        this.setCapabilityValue('tideNextHighLevel', nextHigh.tideLevel).catch(this.error);
      }
    }

    if (nextLow) {
      const formattedTime = nextLow.timestamp.toLocaleTimeString('nb', {
        timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit',
      });
      this.setCapabilityValue('tideNextLowTime', formattedTime).catch(this.error);
      if (!Number.isNaN(nextLow.tideLevel)) {
        this.setCapabilityValue('tideNextLowLevel', nextLow.tideLevel).catch(this.error);
      }
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.logger('Device has been added');
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
      const lat = parseFloat(newSettings.latitude);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        throw new Error('Invalid latitude. Must be a number between -90 and 90.');
      }
      this.latitude = lat;
    } else {
      this.latitude = this.homey.geolocation.getLatitude();
    }
    if (newSettings.longitude) {
      const lon = parseFloat(newSettings.longitude);
      if (Number.isNaN(lon) || lon < -180 || lon > 180) {
        throw new Error('Invalid longitude. Must be a number between -180 and 180.');
      }
      this.longitude = lon;
    } else {
      this.longitude = this.homey.geolocation.getLongitude();
    }

    this.tide.updatePosition(this.latitude, this.longitude);
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.logger('Device was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.homey.clearInterval(this.updateInterval);
    this.homey.clearInterval(this.checkInterval);
    this.logger('Device has been deleted');
  }

}

module.exports = MyDevice;
