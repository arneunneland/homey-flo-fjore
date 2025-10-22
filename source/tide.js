'use strict';

var https = require('https');
const xmlJs = require('xml-js');
var DOMParser = require("@xmldom/xmldom").DOMParser;
var xpath = require("xpath");
const EventEmitter = require('events');
var polynomial = require('everpolate').polynomial

class Tide {
  tideTimes = {};
  events = new Set();

  constructor(homey, latitude, longitude) {
    this.eventEmitter = new EventEmitter()
    this.tideTimes = {};
    this.homey = homey;
    this.latitude = latitude;
    this.longitude = longitude;
  }

  updatePosition(latitude, longitude) { 
    this.latitude = latitude;
    this.longitude = longitude;
    this.updateSealevel();
  }

  processCurrentTide(callback) {
    var today = new Date();

    var nextTide = null;

    if (!this.allEvents) {
      this.homey.log('No tide event data available, skipping');
      return;
    }
    this.allEvents.forEach((event) => {
      if (!nextTide && event.timestamp > today) {
        if (event.type == 'highest') {
          nextTide = { timestamp: event.timestamp, type: "Flo" };
        }
        if (event.type == 'lowest') {
          nextTide = { timestamp: event.timestamp, type: "Fjære" };
        }
      }
    });
    if (!nextTide) {
      this.homey.log('No tide data available, skipping');
      return;
    }

    if (this.latestTime && this.latestTime < (today.getTime() + (60*60000))) {
      this.homey.log('Tide data is not up to date, skipping');
      callback({ 'tideChangeNextHour': null,
                    'tideChangeNext10Min': null,
                    'tideLevel': null,
                    'tideNextType': "Ingen data",
                    'tideNextTime': ""});
      return;
    }
    if (!this.polynomialData) {
      this.homey.log('No polynomial data available, skipping');
      return;
    }

    try {
      var tideLevels = polynomial([today.getTime(), today.getTime() + (60*60000), today.getTime() + (10*60000)], 
      this.polynomialData.x, this.polynomialData.y);

      var currentTideLevel = tideLevels[0];
      var tideChangeNextHour = tideLevels[1] - currentTideLevel;
      var tideChangeNext10Min = tideLevels[2] - currentTideLevel;
      
      // Validate calculated tide level
      if (!this.isValidTideLevel(currentTideLevel)) {
        this.homey.log('Calculated tide level is invalid: ' + currentTideLevel + ', skipping update');
        return;
      }
      
      var formattedHours = nextTide.timestamp.toLocaleTimeString("nb", {timeZone: 'Europe/Oslo', hour: '2-digit', minute:'2-digit'});

      callback({ 'tideChangeNextHour': parseFloat(tideChangeNextHour.toFixed(2)),
        'tideChangeNext10Min': parseFloat(tideChangeNext10Min.toFixed(2)),
        'tideLevel': parseFloat(currentTideLevel.toFixed(2)),
        'tideNextType': nextTide.type,
        'tideNextTime': formattedHours});
      
    } catch (error) {
      this.homey.log('Error processing tide data: ' + error);
    }
  }

  isEventBetween(eventType) {
    var result = false;
    var fromMinute = new Date();
    fromMinute.setMinutes(fromMinute.getMinutes()-90);
    var toMinute = new Date();
    toMinute.setMinutes(toMinute.getMinutes()+90);

    this.allEvents.forEach((event) => {
      if (fromMinute < event.timestamp && 
            toMinute > event.timestamp && 
            event.type === eventType) {
        result = true;
      }
    });
    return result;
  }

  isTideLow() {
    return this.isEventBetween('lowest');
  }
  
  isTideHigh() {
    return this.isEventBetween('highest');
  }

  isTideFalling() {
    var today = new Date();
    if (this.latestTime && this.latestTime < (today.getTime())) {
      return false;
    }
    var tideLevels = polynomial([today.getTime(), today.getTime() + (1*60000)], this.polynomialData.x, this.polynomialData.y);
    var currentTideLevel = tideLevels[0];
    var soonTideLevel = tideLevels[1];
    return soonTideLevel < currentTideLevel;
  }

  isTideRising() {
    var today = new Date();
    if (this.latestTime && this.latestTime < (today.getTime())) {
      return false;
    }
    var tideLevels = polynomial([today.getTime(), today.getTime() + (1*60000)], this.polynomialData.x, this.polynomialData.y);
    var currentTideLevel = tideLevels[0];
    var soonTideLevel = tideLevels[1];
    return soonTideLevel > currentTideLevel;
  }

  checkForEvents() {
    this.events.forEach((event) => {
      if (event.dueDate < Date.now() && event.processed == false) {
        if (event.type === 'highest') {
          this.eventEmitter.emit('highest', { tideLevel: event.tideLevel });
        }
        if (event.type === 'lowest') {
          this.eventEmitter.emit('lowest', { tideLevel: event.tideLevel });
        }
        event.processed = true;
      }
    });
  }

  updateTideData(data) {
    var resultArray = new Array();

    for (const [key, value] of Object.entries(data)) {
      const tideLevelValue = parseFloat(value);
      
      // Validate tide level data
      if (!this.isValidTideLevel(tideLevelValue)) {
        this.homey.log('Invalid tide level detected: ' + value + ' at ' + key + '. Skipping data update.');
        return;
      }
      
      resultArray.push({ 'timestamp': new Date(key),
                          'tideLevel': value });
      this.latestTime = new Date(key);
    }
    this.tideTimes = { 'time': resultArray }

    var fromMinute = new Date();
    fromMinute.setMinutes(fromMinute.getMinutes()-35);
    var xArray = new Array();
    var yArray = new Array();
    this.tideTimes.time.forEach((tideTime) => {
      if (tideTime.timestamp.getTime() > fromMinute.getTime()) {
        const tideLevelValue = parseFloat(tideTime.tideLevel);
        
        // Double-check validity before adding to polynomial data
        if (this.isValidTideLevel(tideLevelValue)) {
          xArray.push(tideTime.timestamp.getTime());
          yArray.push(tideLevelValue);
        }
      }
    });
    this.polynomialData = { 'x': xArray, 'y': yArray };
    this.homey.log("Tide levels updated - " + JSON.stringify(this.tideTimes));
  }

  isValidTideLevel(value) {
    // Check if value is a valid number
    if (isNaN(value) || !isFinite(value)) {
      this.homey.log('Tide level is not a valid number: ' + value);
      return false;
    }
    
    // Check if value is within reasonable bounds (-20 to +20 meters)
    // Most tide levels are within -5 to +5 meters, but using wider range for safety
    if (value < -20 || value > 20) {
      this.homey.log('Tide level outside reasonable range: ' + value + ' meters');
      return false;
    }
    
    return true;
  }

  updateEventData(data) {
    var events = new Set();
    var allEvents = new Set();

    for (const [key, value] of Object.entries(data)) {
      const tideLevelValue = parseFloat(value.tideLevel);
      
      // Validate tide level in event data
      if (!this.isValidTideLevel(tideLevelValue)) {
        this.homey.log('Invalid tide level in event: ' + value.tideLevel + ' at ' + key + '. Skipping event.');
        continue;
      }
      
      if (value.flag == 'high') {
        allEvents.add({ type: 'highest', timestamp: new Date(key)});

        if (new Date(key) > Date.now()) {
          events.add({ processed: false, dueDate: new Date(key), type: 'highest', tideLevel: value.tideLevel });
        }
      }
      if (value.flag == 'low') {
        allEvents.add({ type: 'lowest', timestamp: new Date(key)});

        if (new Date(key) > Date.now()) {
          events.add({ processed: false, dueDate: new Date(key), type: 'lowest', tideLevel: value.tideLevel });
        }
      }
    }
    this.events = events;
    this.allEvents = allEvents;
    this.allEvents.forEach((event) => {
      this.homey.log("Tide events updated - " + event.type + " - " + event.timestamp);
    });
  }


  updateSealevel() {
    var from = new Date();
    from.setHours(from.getHours()-2);

    var toForData = new Date();
    toForData.setHours(from.getHours()+5);
    this.fetchTideData(from, toForData);

    var toForEvents = new Date();
    toForEvents.setHours(from.getHours()+48);
    this.fetchEvents(from, toForEvents);
  }

  fetchTideData(from, to) {
    var tideObj = this;

    var options = {
      host: 'vannstand.kartverket.no',
      port: 443,
      path: '/tideapi.php?lat=' + this.latitude + '&lon=' + this.longitude + '&fromtime=' + from.toISOString() + '&totime=' + to.toISOString() + '&datatype=all&refcode=cd&place=&file=&lang=nn&interval=10&dst=0&tzone=&tide_request=locationdata',
      method: 'GET'
    };

    this.homey.log('Fetching tide data from ' + JSON.stringify(options));

    var req = https.request(options, function(res) {
      var chunks = [];
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', function () {
        try {
          var body = Buffer.concat(chunks).toString('utf8');
          let doc = new DOMParser().parseFromString(body);

          var nodes = xpath.select("//waterlevel[@flag='forecast']", doc);
          const hashMap = nodes.reduce((result, item) => {
            return { ...result, [ item.getAttribute("time") ] : item.getAttribute("value") };
          }, {});
          tideObj.updateTideData(hashMap);
        } catch (error) {
          console.log('problem with xml-tide: ' + error);
        }
      });
    });
    
    req.on('error', function(e) {
      console.log('problem with request: ' + e.message);
    });
    req.end();
  }

  fetchEvents(from, to) {
    var tideObj = this;
    var options = {
      host: 'vannstand.kartverket.no',
      port: 443,
      path: '/tideapi.php?lat=' + this.latitude + '&lon=' + this.longitude + '&fromtime=' + from.toISOString() + '&totime=' + to.toISOString() + '&datatype=tab&refcode=cd&place=&file=&lang=nn&interval=10&dst=0&tzone=&tide_request=locationdata',
      method: 'GET'
    };

    this.homey.log('Fetching event data from ' + JSON.stringify(options));

    var req = https.request(options, function(res) {
      var chunks = [];
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', function () {
        try {
          var body = Buffer.concat(chunks).toString('utf8');
          let doc = new DOMParser().parseFromString(body);
  
          var nodes = xpath.select("//waterlevel", doc);
          const hashMap = nodes.reduce((result, item) => {
            return { ...result, [ item.getAttribute("time") ] : { "tideLevel": item.getAttribute("value"), "flag": item.getAttribute("flag") } };
          }, {});
          tideObj.updateEventData(hashMap);
        } catch (error) {
          console.log('problem with xml-event: ' + error);
        }
      });
    });
    
    req.on('error', function(e) {
      console.log('problem with request: ' + e.message);
    });
    req.end();
  }
}

module.exports = Tide;

