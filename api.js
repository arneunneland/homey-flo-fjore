'use strict';

module.exports = {
  async log({ homey, query }) {
    const result = await homey.app.fetchLogs();

    return result;
  },

};
