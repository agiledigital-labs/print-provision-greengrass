const axios = require('axios');
const awsIot = require('aws-iot-device-sdk');

// todo use version configured in GG recipe instead. check if we actually need this in the logs
//      first (and whatever it was doing with the health check). probably don't
const serviceVersion = '0.2.0';

/** The URL for the ReceiptPrinterHTTPInterface component. */
const httpInterfaceBaseUrl = 'http://localhost:8083';

/** The name of this IoT Thing (i.e. device, e.g. a Raspberry Pi) in AWS. */
const thingName = process.env.AWS_IOT_THING_NAME;

// MQTT topic used to receive new print jobs.
const printJobTopic = `print-job/${thingName}`;

/** The config needed to connect to AWS IoT's MQTT broker. */
const deviceOptions = (clientId) => ({
  clientId,
  // todo hardcoded paths
  keyPath: '/greengrass/v2/privKey.key',
  certPath: '/greengrass/v2/thingCert.crt',
  caPath: '/greengrass/v2/rootCA.pem',
  // todo don't hardcode this. effectiveConfig.yaml has "iotDataEndpoint", which looks similar to
  //      this url. but it's in the config for the Nucleus component
  host: 'a21gb26zq6ucj0-ats.iot.ap-southeast-2.amazonaws.com'
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
  // todo just log the size of the data?
  logMessage('Success',
    `Received print job. Submitting it to ReceiptPrinter. Data: [${data}].`,
    id);

  // Forward the print job on to the HTTP interface.
  const params = new URLSearchParams();
  params.append('remoteJobId', id);
  params.append('data', data);

  const response = await axios.post(`${httpInterfaceBaseUrl}/submit`, params);

  // todo delete
  console.log(`response status: ${JSON.stringify(response.status)}`);
  console.log(`response data: ${JSON.stringify(response.data)}`);

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

  // todo handle (or at least log) other events such as 'disconnect' or 'offline'?
  // https://github.com/mqttjs/MQTT.js/blob/master/README.md#client
};

main();
