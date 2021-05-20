const axios = require('axios');
const awsIot = require('aws-iot-device-sdk');
const argsParser = require('args-parser');

// todo use version configured in GG recipe instead. check if we actually need this in the logs
//      first (and whatever it was doing with the health check). probably don't
const serviceVersion = '0.2.0';

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

/** The config needed to connect to AWS IoT's MQTT broker. */
const deviceOptions = (clientId) => ({
  clientId,
  // The README tells you to install to /greengrass/v2, so these paths should work.
  keyPath: '/greengrass/v2/privKey.key',
  certPath: '/greengrass/v2/thingCert.crt',
  caPath: '/greengrass/v2/rootCA.pem',
  host: mqttEndpointAddress
});

/**
 * todoc update
 * Log message is in a format for hc.sh to pickup, separated by pipe "|" with specific order:
 * [serviceService]|[status]|[Log Date Time]|[print job id]|[message]
 * 
 * @param {*} status of the message represents: Success or Failed.
 * @param {*} message to be logged.
 * @param {*} printJobId id of the print job.
 */
const logMessage = (status, message, printJobId) => {
  console.log(`${serviceVersion}|${status}|${new Date().toISOString()}|${printJobId}|${message}`);
};

/** Submit the job to be printed (via the HTTP interface). */
const submitPrintJob = async (id, data) => {
  logMessage('Success', `Received print job. Submitting it to ReceiptPrinter.`, id);

  // Forward the print job on to the HTTP interface.
  const params = new URLSearchParams();
  params.append('remoteJobId', id);
  params.append('data', data);

  const response = await axios.post(`${httpInterfaceBaseUrl}/submit`, params);

  if (response.status === 200 && response.data.pass) {
    logMessage('Success', 'Submitted print job.', id);
  } else {
    logMessage('Failed',
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
    logMessage('Success', `[${thingName}] is connected`, 'N/A');
  });

  device.on('disconnect', () => {
    logMessage('Failed', `[${thingName}] is disconnected from MQTT`, 'N/A');
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
      logMessage('Success',
        `Received message on topic [${topic}] for Thing [${thingName}]. Ignoring.`,
        'N/A');
    }
  });

  // TODO: Should we handle (or at least log) other events such as 'offline'?
  //       https://github.com/mqttjs/MQTT.js/blob/master/README.md#client
};

main();
