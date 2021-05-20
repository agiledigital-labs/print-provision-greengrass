// todo what to do about https://github.com/DataPOS-Labs/print-provision#raspberry-pi-deps ? still
//      make it manual? only part of it? see 'Bootstrap' in
//      https://docs.aws.amazon.com/greengrass/v2/developerguide/component-recipe-reference.html
//      and
//      https://docs.aws.amazon.com/greengrass/v2/developerguide/component-recipe-reference.html#install-lifecycle-definition

// todo same questions about https://github.com/DataPOS-Labs/print-provision#raspberry-pi-deployment-wifi-connection-lost-issue
//      and https://github.com/DataPOS-Labs/print-provision#pre-provision and probably other things
//      in the README

const express = require('express');
const axios = require('axios');
const awsIot = require('aws-iot-device-sdk');
const bodyParser = require('body-parser');
const fp = require('lodash/fp');
const urlencode = require('urlencode');
const argsParser = require('args-parser');

const app = express();
const args = argsParser(process.argv);

// todo use version configured in GG recipe instead. check if we actually need this in the logs
//      first (and whatever it was doing with the health check). probably don't
const serviceVersion = '0.2.0';

/** The duration in milliseconds between reporting the device status to core-services. */
const healthHeartBeatInterval = 60 * 1000;

/** The name of this IoT Thing (i.e. device, e.g. a Raspberry Pi) in AWS. */
const thingName = process.env.AWS_IOT_THING_NAME;

// todoc comments for these
const printServerUrl = args['print-server-url'];
const dataposApiUrl = args['datapos-api-url'];
const vendorUsername = args['vendor-username'];
const vendorPassword = args['vendor-password'];

/**
 * @see https://docs.aws.amazon.com/iot/latest/developerguide/iot-connect-devices.html#iot-connect-device-endpoints
 */
const mqttEndpointAddress = args['mqtt-endpoint-address'];

app.use(bodyParser.urlencoded({ extended: true }));

const deviceOptions = (clientId) => ({
  clientId,
  // The README tells you to install to /greengrass/v2, so these paths should work.
  keyPath: '/greengrass/v2/privKey.key',
  certPath: '/greengrass/v2/thingCert.crt',
  caPath: '/greengrass/v2/rootCA.pem',
  host: mqttEndpointAddress
});

// Holds print jobs in a specific format that is required by PrintOS.jar.
let printJobs = {
  ids: [],
  data: []
};

let lastHealthStatus = {};

// todo comment this out at first? after that i'm not sure. maybe it will just work. does
//      provision.js create a device shadow or anything like that?
// todo check the thing shadow is working properly. might need to ask haolin to explain it
let thingShadow = undefined;

/**
 * Log message is in a format for hc.sh to pickup, separated by pipe "|" with specific order:
 * [serviceService]|[status]|[Log Date Time]|[print job id]|[message]
 * 
 * @param {*} status of the message represents: Success or Failed.
 * @param {*} message to be logged.
 * @param {*} printJobId id of the print job.
 */
const logMessage = (status, message, printJobId) => {
  console.log(`${serviceVersion}|${status}|${new Date().toISOString()}|${printJobId}|${message}`);

  lastHealthStatus = {
    status,
    message,
    printJobId
  };

  // Updates the Thing Shadow's desired state, reports current device's status.
  thingShadow && thingShadow.update(thingName, {
    state: {
      desired: lastHealthStatus
    }
  });
};

/**
 * Create and register the Thing Shadow, which records the most recent print status for the device.
 *
 * The Thing Shadow document can be checked in the AWS IoT Thing console. It will likely be under
 * the name "Classic Shadow".
 */
const setUpThingShadow = () => {
  try {  
    // Device thing shadow that reports the device current print status.
    thingShadow = new awsIot.thingShadow(deviceOptions(`${thingName}-shadow`));

    // Registers the Thing Shadow with the Thing name.
    thingShadow.register(thingName);
  } catch (err) {
    console.error(err);
    
    logMessage('Failed', `Failed to create Thing Shadow [${err.message}]`, 'N/A');
  }
};

// Handles local print job submission only. todoc update comment
app.post('/submit', (req, res) => {
  // todo delete
  console.log(`req.query`);
  console.dir(req.query);
  console.log(`req.body`);
  console.dir(req.body);
  const data = req.body;
  console.log('data.remoteJobId');
  console.dir(data.remoteJobId);
  // todo return 400 if typeof data.data !== 'string'
  const printData = urlencode.decode(data.data.replace(/\+/g, '%20'));

  // Check we haven't already received this job. This won't affect local jobs because they probably
  // don't come with an ID. Or at least they don't use "remoteJobId".
  if (typeof data.remoteJobId === 'string' &&
    printJobs.ids.includes(data.remoteJobId)) {
    logMessage('Success', 'Ignoring duplicate message for print job', data.remoteJobId);
    res.send({ pass: true });
    return;
  }

  // Local print job has id of -1 for PrintOS.jar.
  // todoc add remoteJobId to the http interface docs. (if there are none, write some)
  const id = data.remoteJobId || '-1';

  // todo return 400 if typeof id !== 'string'

  printJobs.ids.push(id);
  printJobs.data.push(printData);

  console.log(
    `Added print job [${id}] to the queue. Job data: [${printData}], queue IDs: ` +
      `[${JSON.stringify(printJobs.ids)}], queue data: [${JSON.stringify(printJobs.data)}]`);

  res.send({ pass: true });
});

// Handles the lookup for print jobs in the memory.
app.post('/lookup', (_req, res) => {
  console.log(
    `Looked up queue. IDs: [${JSON.stringify(printJobs.ids)}], data: [${JSON.stringify(printJobs.data)}]`);

  res.send({
    pass: true,
    version: 5,
    ids: printJobs.ids,
    data: printJobs.data
  });
});

// todoc check slack msgs from haolin about this and add more info/context to these comments, e.g.
//      explain why we need this and what it's currently being used for
// Called by local only and update the print job remotely.
// Updates the remote print job status, so it will not be retried.
app.post('/update', async (req, res) => {
  try {
    // Local print jobs will have -1 as job id.
    // todo add a const (or whatever) so the code doesn't have '-1' in several places
    if (req.body.id !== '-1') {
      logMessage('Success',
        `Updating print job [${req.body.id}], status: [${req.body.status}], req.ip: [${req.ip}]...`,
        req.body.id);

      const params = new URLSearchParams();
      params.append('id', req.body.id);

      // Status could be exception message from the PrintOS Java print driver, 
      //  so we need to make sure we update with valid status Active if it is not Completed, so it can be retried.
      params.append('status', req.body.status === 'Completed' ? 'Completed' : 'Active');
      params.append('username', req.body.username);
      params.append('password', req.body.password);

      const response = await axios.post(`${printServerUrl}/update`, params);

      if (response.status !== 200 && req.body.status === 'Completed') {
        logMessage('Failed',
          `Print job [${req.body.id}] update failed, but print job succeed, status [${req.body.status}]`,
          req.body.id);

        return res.send({
          pass: false
        });
      }

      // Remove the print job from the in-memory queue, since it was updated successfully.
      const index = printJobs.ids.indexOf(req.body.id);
      if (index !== -1) {
        printJobs.ids.splice(index, /* deleteCount = */ 1);
        printJobs.data.splice(index, /* deleteCount = */ 1);

        logMessage('Success',
          `Removed print job from in-memory queue. Index of removed: [${index}], queue IDs: ` +
            `[${JSON.stringify(printJobs.ids)}], queue data: [${JSON.stringify(printJobs.data)}]`,
          req.body.id);
      } else {
        // PrintOS.jar usually makes several of these requests when a job completes, so we can't
        // treat this as an error.
        logMessage('Success',
          'Could not find print job in in-memory queue. Assuming this is a redundant update.',
          req.body.id);
      }

      if (req.body.status === 'Completed') {
        logMessage('Success', `Print job [${req.body.id}] completed`, req.body.id);

        return res.send({ pass: true });
      } else {
        logMessage('Failed', `Print job [${req.body.id}] failed, status [${req.body.status}]`, req.body.id);

        return res.send({ pass: false });
      }
    } else {
      const index = fp.indexOf(req.body.id)(printJobs.ids);
      printJobs.ids = fp.remove(id => id === req.body.id)(printJobs.ids);
      printJobs.data.splice(index, 1);

      return res.send({
        pass: true
      });
    }
  } catch (err) {
    console.error(err);
    logMessage('Failed',
      `Failed to update job ` +
        `[${(req && req.body && req.body.id) ? req.body.id : 'unknown ID'}] ` +
        `[${(err && err.message) ? err.message : JSON.stringify(err)}]`,
      'N/A');

    return res.send({
      pass: false
    });
  }
});

// todo check whether greengrass fully replaces manual health check functionality
// todo what should we do with the server end of the health check? just delete it? is it used for
//      anything else? probably talk to haolin about it
// todo put `nvm use` in the README
// todo need to create a policy for each device like provision.js does?
// todo does stdout and stderr from this app and from PrintOS.jar end up in the right place
//      (somewhere in AWS, i assume)
const reportHealthCheck = async () => {
  try { 
    console.log('Reporting health...');

    // Allow auth cookies to be passed.
    const transport = axios.create({
      withCredentials: true
    });

    const params = new URLSearchParams();
    params.append('username', vendorUsername);
    params.append('password', vendorPassword);
    // todo delete
    console.log(`vendorUsername: ${vendorUsername}`);
    console.log(`vendorPassword: ${vendorPassword}`);
    console.log(`dataposApiUrl: ${dataposApiUrl}`);

    const response = await axios.post(`${dataposApiUrl}/v1/current-vendor/login`, params);

    const authCookie = response.headers['set-cookie'][0];

    // todo this is failing with 400
    // const hcResponse = await axios.post(`${dataposApiUrl}/v1/current-vendor/external-service/status`, {
    //   externalService: {
    //     serviceVendorUser: vendorUsername,
    //     serviceType: `print-${thingName}`,
    //     serviceVersion: serviceVersion
    //   },
    //   status: lastHealthStatus.status,
    //   message: lastHealthStatus.message,
    //   lastSuccessId: lastHealthStatus.printJobId && lastHealthStatus.printJobId.toString(),
    //   lastSuccessTime: new Date().toISOString()
    // }, {
    //   headers: {
    //     Cookie: authCookie,
    //     'Content-Type': 'application/json'
    //   }
    // });
  } catch (err) {
    console.error('Failed to report health', err.message);
    console.error(err);
    console.error(err.response.data);
    console.error(err.response.status);
    console.error(err.response.headers);
  }
};

const main = () => {
  // todo delete
  console.log(JSON.stringify(process.env));

  // See https://docs.aws.amazon.com/iot/latest/developerguide/iot-device-shadows.html
  setUpThingShadow();

  // Report the device's health every healthHeartBeatInterval ms.
  setInterval(reportHealthCheck, healthHeartBeatInterval);

  // Start the HTTP server.
  app.listen(8083);
};

main();
