'use strict';

const Homey = require('homey');

class MyApp extends Homey.App {

  logEntries = [];

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.logger = async (data) => {
      this.homey.log(data);
      if (this.logEntries.length > 200) {
        this.logEntries.shift();
      }
      this.logEntries.push(`${new Date().toISOString()}: ${data}`);
    };

    this.log('Flo og fjære has been initialized');
  }

  fetchLogs() {
    return this.logEntries.join('\n');
  }

}

module.exports = MyApp;
