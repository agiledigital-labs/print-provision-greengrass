const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const fp = require('lodash/fp');
const urlencode = require('urlencode');
const argsParser = require('args-parser');
const healthReporting = require('health-reporting');

const args = argsParser(process.argv);

/** The port to serve the HTTP interface on. */
const httpPort = 8083;

/**
 * The base URL for your printos-serverless-service
 * (https://github.com/DataPOS-Labs/printos-serverless-service) deployment. Used to report the
 * status of the print jobs so printos-serverless-service knows when to stop retrying them.
 */
const printServerUrl = args['print-server-url'];

/**
 * The base URL for the DataPOS Public API, which is exposed by Core Services
 * (https://stash.agiledigital.com.au/projects/QFX/repos/merivale/browse/server/modules/core-services).
 * Used to report the health status of the device.
 */
const dataposApiUrl = args['datapos-api-url'];

/**
 * The vendor's username for authenticating with the DataPOS Public API. Used to report the health
 * status of the device.
 */
const vendorUsername = args['vendor-username'];

/**
 * The vendor's password for authenticating with the DataPOS Public API. Used to report the health
 * status of the device.
 */
const vendorPassword = args['vendor-password'];

/**
 * The address to connect to the AWS MQTT broker. You can find this in the AWS console at
 *   https://console.aws.amazon.com/iot/home#/settings
 * or by running
 *   aws iot describe-endpoint --endpoint-type iot:Data-ATS
 *
 * @see https://docs.aws.amazon.com/iot/latest/developerguide/iot-connect-devices.html#iot-connect-device-endpoints
 */
const mqttEndpointAddress = args['mqtt-endpoint-address'];

/** The version number of this component. */
const componentVersion = args['component-version'];

// Holds print jobs in a specific format that is required by PrintOS.jar.
let printJobs = {
  ids: [],
  data: []
};

/**
 * @param {string} message The message to log.
 * @param {string?} printJobId The ID of the associated print job. Optional.
 */
const log = (message, printJobId) =>
    healthReporting.log(componentVersion, message, printJobId);

const updateHealthStatus = (status, message, printJobId) =>
    healthReporting.updateHealthStatus(componentVersion, status, message, printJobId);

/** Handle submission of a print job. Can be either a remote (from the cloud) or local job. */
const handleSubmit = async (req, res) => {
  const data = req.body;

  // Return 400 (Bad Request) if the data has an unexpected type.
  if (typeof data.data !== 'string') {
    res.sendStatus(400);
    return;
  }

  const printData = urlencode.decode(data.data.replace(/\+/g, '%20'));

  // Check we haven't already received this job. This won't affect local jobs because they probably
  // don't come with an ID. Or at least they don't use "remoteJobId".
  if (typeof data.remoteJobId === 'string' &&
    printJobs.ids.includes(data.remoteJobId)) {
    log('Ignoring duplicate message for print job', data.remoteJobId);
    res.send({ pass: true });
    return;
  }

  // Local print job has id of -1 for PrintOS.jar.
  // todoc add remoteJobId to the http interface docs. (if there are none, write some)
  const id = data.remoteJobId || '-1';

  // Return 400 (Bad Request) if the ID has an unexpected type.
  if (typeof id !== 'string') {
    res.sendStatus(400);
    return;
  }

  printJobs.ids.push(id);
  printJobs.data.push(printData);

  updateHealthStatus(
    'Success',
    `Added print job to the queue. Job data: [${printData}], queue IDs: ` +
      `[${JSON.stringify(printJobs.ids)}], queue data: [${JSON.stringify(printJobs.data)}]`,
    id);

  res.send({ pass: true });
};

/**
 * Handle a request to look up the print jobs in memory. The ReceiptPrinter component polls this
 * regularly and will print the jobs it returns.
 */
const handleLookup = async (_req, res) => {
  // Log a message if there were jobs in the queue.
  if (printJobs.ids.length !== 0 || printJobs.data.length !== 0) {
    log(`Looked up queue. IDs: [${JSON.stringify(printJobs.ids)}], ` +
        `data: [${JSON.stringify(printJobs.data)}]`);
  }

  res.send({
    pass: true,
    version: 5,
    ids: printJobs.ids,
    data: printJobs.data
  });
};

/**
 * Handle a request to report the status of a print job to the print server. The main purpose of
 * this is to let the print server know when a job is completed so it won't keep retrying it. Only
 * the ReceiptPrinter component makes these requests.
 */
const handleUpdate = async (req, res) => {
  try {
    // Local print jobs will have -1 as job id.
    // TODO: Add a const (or whatever) so the code doesn't have '-1' in several places.
    if (req.body.id !== '-1') {
      log(`Updating print job [${req.body.id}], status: [${req.body.status}], req.ip: [${req.ip}]...`,
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
        updateHealthStatus('Failed',
          `Print job [${req.body.id}] update failed, but print job succeed, status [${req.body.status}]`,
          req.body.id);

        return res.send({ pass: false });
      }

      // Remove the print job from the in-memory queue, since it was updated successfully.
      const index = printJobs.ids.indexOf(req.body.id);
      if (index !== -1) {
        printJobs.ids.splice(index, /* deleteCount = */ 1);
        printJobs.data.splice(index, /* deleteCount = */ 1);

        log(`Removed print job from in-memory queue. Index of removed: [${index}], queue IDs: ` +
            `[${JSON.stringify(printJobs.ids)}], queue data: [${JSON.stringify(printJobs.data)}]`,
          req.body.id);
      } else {
        // PrintOS.jar usually makes several of these requests when a job completes, so we can't
        // treat this as an error.
        log('Could not find print job in in-memory queue. Assuming this is a redundant update.',
          req.body.id);
      }

      if (req.body.status === 'Completed') {
        updateHealthStatus('Success', `Print job [${req.body.id}] completed`, req.body.id);

        return res.send({ pass: true });
      } else {
        updateHealthStatus('Failed',
            `Print job [${req.body.id}] failed, status [${req.body.status}]`,
            req.body.id);

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
    updateHealthStatus('Failed',
      `Failed to update job ` +
        `[${(req && req.body && req.body.id) ? req.body.id : 'unknown ID'}] ` +
        `[${(err && err.message) ? err.message : JSON.stringify(err)}]`);

    return res.send({
      pass: false
    });
  }
};

const main = () => {
  // Log the environment vars.
  log(JSON.stringify(process.env));

  // TODO: Check that all of the CLI options were passed in.

  // Regularly send the health status of this component to the server.
  healthReporting.startReporting(
      'http', componentVersion, dataposApiUrl, vendorUsername, vendorPassword, mqttEndpointAddress);

  // Set up the HTTP server.
  const app = express();

  // Parse incoming requests with urlencoded payloads.
  app.use(bodyParser.urlencoded({ extended: true }));

  // Set up the routes.
  app.post('/submit', handleSubmit);
  app.post('/lookup', handleLookup);
  app.post('/update', handleUpdate);

  // Start the HTTP server.
  app.listen(httpPort);
};

main();
