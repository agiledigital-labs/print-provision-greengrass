const axios = require('axios');
const awsIot = require('aws-iot-device-sdk');
const argsParser = require('args-parser');

/** The URL for the ReceiptPrinterHTTPInterface component. */
const httpInterfaceBaseUrl = 'http://localhost:8083';

/** The name of this IoT Thing (i.e. device, e.g. a Raspberry Pi) in AWS. */
const thingName = process.env.AWS_IOT_THING_NAME;

/** MQTT topic used to receive new print jobs. */
const printJobTopic = `print-job/${thingName}`;

/** CLI options */
const args = argsParser(process.argv);

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

/** The config needed to connect to AWS IoT's MQTT broker. */
const deviceOptions = (clientId) => ({
  clientId,
  // The README tells you to install to /greengrass/v2, so these paths should work. We could use
  // {kernel:rootPath} in the recipe to pass the path in as a CLI arg, but it might not be worth the
  // effort.
  keyPath: '/greengrass/v2/privKey.key',
  certPath: '/greengrass/v2/thingCert.crt',
  caPath: '/greengrass/v2/rootCA.pem',
  host: mqttEndpointAddress
});

let lastHealthStatus = {};

/**
 * @param {string} message The message to log.
 * @param {string?} printJobId The ID of the associated print job. Optional.
 */
const log = (message, printJobId) => {
  console.log(JSON.stringify({
    componentVersion,
    lastHealthStatus: lastHealthStatus.status,
    printJobId: printJobId || 'N/A',
    message
  }));
};

/**
 * Set the latest the health status data and log it.
 *
 * @param {string} status of the message represents: Success or Failed.
 * @param {string} message to be logged and reported.
 * @param {string?} printJobId The ID of the print job. Optional
 */
const updateHealthStatus = (status, message, printJobId) => {
  lastHealthStatus = {
    status,
    message,
    printJobId: printJobId || 'N/A',
  };

  log(printJobId, message);
};

/** Submit the job to be printed (via the HTTP interface). */
const submitPrintJob = async (id, data) => {
  log('Received print job. Submitting it to ReceiptPrinter.', id);

  // Forward the print job on to the HTTP interface.
  const params = new URLSearchParams();
  params.append('remoteJobId', id);
  params.append('data', data);

  const response = await axios.post(`${httpInterfaceBaseUrl}/submit`, params);

  if (response.status === 200 && response.data.pass) {
    updateHealthStatus('Success', 'Submitted print job.', id);
  } else {
    updateHealthStatus('Failed',
      `Failed to submit print job. Status code: [${response.status}], ` +
      `response: [${response.data}]`,
      id);
  }
};

const main = () => {
  // Log the environment vars.
  console.log(JSON.stringify(process.env));

  const device = new awsIot.device(deviceOptions(`${thingName}-device`));

  // Subscribe to the print job topic for this device.
  device.subscribe(printJobTopic);
 
  // Log when MQTT connects or disconnects.
  device.on('connect', () => {
    updateHealthStatus('Success', `[${thingName}] is connected`);
  });

  device.on('disconnect', () => {
    updateHealthStatus('Failed', `[${thingName}] is disconnected from MQTT`);
  });

  // Handle the MQTT messages, which each contain a print job.
  device.on('message', (topic, payload) => {
    if (topic === printJobTopic) {
      // Parse the message.
      const parsedPayload = JSON.parse(payload.toString());
      const { id, data } = parsedPayload;

      // Send the print job along to be printed.
      submitPrintJob(id, data);
    } else {
      log(`Received message on topic [${topic}] for Thing [${thingName}]. Ignoring.`);
    }
  });

  // TODO: Should we handle (or at least log) other events such as 'offline'?
  //       https://github.com/mqttjs/MQTT.js/blob/master/README.md#client
};

main();
