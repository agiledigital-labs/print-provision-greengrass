/*
 If you want to run this without Greengrass for testing, download or copy privKey.key, thingCert.crt
 and rootCA.pem, then change the `deviceOptions` paths in this file so they point to the certs. Then
 use:

 node mqtt-interface.js \
   "--datapos-api-url=https://public-api.shared.staging.datapos.io" \
   "--vendor-username=brod" \
   "--vendor-password=1234" \
   "--mqtt-endpoint-address=a117qnlskg6hvb-ats.iot.ap-southeast-2.amazonaws.com" \
   "--component-version=1.0.0"

 You'll probably need to change --print-server-url and --mqtt-endpoint-address. See deployment.yaml.
 */
const axios = require('axios');
const awsIot = require('aws-iot-device-sdk');
const argsParser = require('args-parser');
const healthReporting = require('health-reporting');

/** A short name to identify this Greengrass component. */
const componentShortName = 'mqtt';

/** The URL for the ReceiptPrinterHTTPInterface component. */
const httpInterfaceBaseUrl = 'http://localhost:8083';

/** The name of this IoT Thing (i.e. device, e.g. a Raspberry Pi) in AWS. */
const thingName = process.env.AWS_IOT_THING_NAME;

/** MQTT topic used to receive new print jobs. */
const printJobTopic = `print-job/${thingName}`;

/** CLI options */
const args = argsParser(process.argv);

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

/**
 * @param {string} message The message to log.
 * @param {string?} printJobId The ID of the associated print job. Optional.
 */
const log = (message, printJobId) =>
    healthReporting.log(componentVersion, message, printJobId);

const updateHealthStatus = async (status, message, printJobId) =>
    await healthReporting.updateHealthStatus(
        componentShortName, componentVersion, status, message, printJobId);

/** Submit the job to be printed (via the HTTP interface). */
const submitPrintJob = async (id, data) => {
  log('Received print job. Submitting it to ReceiptPrinter.', id);

  // Forward the print job on to the HTTP interface.
  const params = new URLSearchParams();
  params.append('remoteJobId', id);
  params.append('data', data);

  const response = await axios.post(`${httpInterfaceBaseUrl}/submit`, params);

  if (response.status === 200 && response.data.pass) {
    await updateHealthStatus('Success', 'Submitted print job.', id);
  } else {
    await updateHealthStatus('Failed',
      `Failed to submit print job. Status code: [${response.status}], ` +
      `response: [${response.data}]`,
      id);
  }
};

const main = () => {
  // Log the environment vars and CLI options.
  log(JSON.stringify(process.env));
  log(JSON.stringify({
    componentVersion, dataposApiUrl, vendorUsername, vendorPassword, mqttEndpointAddress
  }));

  // TODO: Check that all of the CLI options were passed in.

  // Regularly send the health status of this component to the server.
  healthReporting.startReporting(
      componentShortName,
      componentVersion,
      dataposApiUrl,
      vendorUsername,
      vendorPassword,
      mqttEndpointAddress);

  // Create the MQTT connection to AWS IoT. If the device goes offline, this will automatically
  // reconnect MQTT when the device reconnects to the internet.
  const device = new awsIot.device(deviceOptions(`${thingName}-${componentShortName}`));

  // Subscribe to the print job topic for this device.
  device.subscribe(printJobTopic);
 
  // Log when MQTT connects or disconnects.
  device.on('connect', async () => {
    await updateHealthStatus('Success', `[${thingName}] is connected`);
  });

  device.on('disconnect', async () => {
    await updateHealthStatus('Failed', `[${thingName}] is disconnected from MQTT`);
  });

  // Handle the MQTT messages, which each contain a print job.
  device.on('message', async (topic, payload) => {
    if (topic === printJobTopic) {
      // Parse the message.
      const parsedPayload = JSON.parse(payload.toString());
      const { id, data } = parsedPayload;

      // Send the print job along to be printed.
      await submitPrintJob(id, data);
    } else {
      log(`Received message on topic [${topic}] for Thing [${thingName}]. Ignoring.`);
    }
  });

  // TODO: Should we handle (or at least log) other events such as 'offline'? It could be useful to
  //       to know when the device was and wasn't online, and the disconnect message doesn't get
  //       logged. (Tested by running `ifconfig wlan0 down`.)
  //       https://github.com/mqttjs/MQTT.js/blob/master/README.md#client
};

main();
