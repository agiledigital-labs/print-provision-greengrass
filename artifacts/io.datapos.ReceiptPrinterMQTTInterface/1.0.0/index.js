const axios = require('axios');

// todo use qos exactly_once so the app code doesn't have to track job ids and discard duplicates
//      actually, printos-serverless-service has retry logic, so that wouldn't work. maybe just
//      delete its retry logic. but then, will the message be retried if the print job fails halfway
//      through? is a lambda invocation atomic wrt mqtt retries?
// todo need to update the device shadow? probably depends on whether we still need the server code
//      for status reporting (hc.sh?). if not, delete the server code too eventually?
// todo delete mqtt-interface.js
// todoc how to deploy this lambda/component. maybe write a script?
//       need a function.conf (eg
//       https://github.com/aws-samples/aws-greengrass-lambda-functions/blob/master/functions/HelloWorldNode/function.conf)?
//       i've been manually uploading zip files
//       rm ReceiptPrinterMQTTInterface.zip && zip -r ReceiptPrinterMQTTInterface.zip node_modules/ index.js
// todo how to deploy this lambda/component locally for testing?
// todo delete the recipe for this component if its unused
// todo add the http interface to "component dependencies". and http should probably depend on
//      receiptprinter
// todo LogManager (public component)
// todo maybe mention LocalDebugConsole in docs. (it shouldnt be installed for prod devices though)
// todo when you make a new version of the component in AWS, you need to configure it to receive
//      MQTT events for topic "print-job/${AWS_IOT_THING_NAME}". it's not documented, but the env
//      var does seem to get substituted
// todo write scripts to create the GG components
// todo write a script to create the GG deployment for the Pis

// todo use version configured in GG recipe instead. check if we actually need this in the logs
//      first (and whatever it was doing with the health check). probably don't
const serviceVersion = '0.2.0';

/** The URL for the ReceiptPrinterHTTPInterface component. */
const httpInterfaceBaseUrl = 'http://localhost:8083';

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

// todo delete
console.log(JSON.stringify(process.env));

exports.handler = async (event, context) => {
  // todo delete (or clean up)
  console.log('event: ' + JSON.stringify(event));
  console.log('context: ' + JSON.stringify(context));

  // todo do we actually need to append the req id ourselves or can aws correlate the messages some
  //      other way?
  const log = message =>
    console.log(`${message} RequestId: [${context.awsRequestId}]`);

  // todo submit the job to the http interface. don't forget id
  // todo just log the size of .data
  log(`Received print job with ID [${event.id}], size [${event.data}]. Submitting it to ReceiptPrinter.`);

  const params = new URLSearchParams();
  params.append('remoteJobId', event.id);
  params.append('data', event.data);

  const response = await axios.post(`${httpInterfaceBaseUrl}/submit`, params);

  // todo delete
  console.log(`response status: ${JSON.stringify(response.status)}`);
  console.log(`response data: ${JSON.stringify(response.data)}`);

  if (response.status === 200 && response.data.pass) {
    log(`Submitted print job [${event.id}]`);
  } else {
    // todo anything else we should do here?
    log(`Failed to submit print job [${event.id}]. Status code: [${response.status}]`);
    throw new Error(`Failed to submit print job [${event.id}]. Status code: [${response.status}]`);
  }
};
