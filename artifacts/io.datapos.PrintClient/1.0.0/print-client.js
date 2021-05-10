// todo what to do about https://github.com/DataPOS-Labs/print-provision#raspberry-pi-deps ? still
//      make it manual? only part of it? see 'Bootstrap' in
//      https://docs.aws.amazon.com/greengrass/v2/developerguide/component-recipe-reference.html
//      and
//      https://docs.aws.amazon.com/greengrass/v2/developerguide/component-recipe-reference.html#install-lifecycle-definition

// todo same questions about https://github.com/DataPOS-Labs/print-provision#raspberry-pi-deployment-wifi-connection-lost-issue
//      and https://github.com/DataPOS-Labs/print-provision#pre-provision and probably other things
//      in the README

// todo auto npm install? just put it in the README?


// todo are all these deps still required?
const express = require('express');
const axios = require('axios');
const awsIot = require('aws-iot-device-sdk');
const bodyParser = require('body-parser');
const fp = require('lodash/fp');
const uuid = require('uuid');
const urlencode = require('urlencode');
const argsParser = require('args-parser');

const app = express();
const args = argsParser(process.argv);

// todo use version configured in GG recipe instead. check if we actually need this in the logs
//      first (and whatever it was doing with the health check). probably don't
const serviceVersion = '0.2.0';

// todoc comments for these
const thingName = process.env.AWS_IOT_THING_NAME;
const printServerUrl = args['print-server-url'];
// todo use or delete this
const destinationPassword = args['destination-password'];

app.use(bodyParser.urlencoded({ extended: true }));

// todo try to figure these out from env vars or whatever
//      actually, reading them from the config is probably better. see
//      https://docs.aws.amazon.com/greengrass/v2/developerguide/ipc-component-configuration.html
//      i think they ultimately come from /greengrass/config/config.json (including `host`)
//      or maybe the SDK will be able to just figure these out automatically. see
//      https://docs.aws.amazon.com/greengrass/v2/developerguide/token-exchange-service-component.html
//      and https://docs.aws.amazon.com/greengrass/v2/developerguide/interact-with-aws-services.html
//      or it might be ok as it is if we get "/greengrass/v2" from an env var
//      pass these in as cli opts. from /greengrass/v2/config/effectiveConfig.yaml (or whatever):
//      system:
//        certificateFilePath: "/greengrass/v2/thingCert.crt"
//        privateKeyPath: "/greengrass/v2/privKey.key"
//        rootCaPath: "/greengrass/v2/rootCA.pem"
//
// todo try to take 'sudo' out of the run command in the recipe
const deviceOptions = (clientId) => ({
  clientId,
  keyPath: '/greengrass/v2/privKey.key',
  certPath: '/greengrass/v2/thingCert.crt',
  caPath: '/greengrass/v2/rootCA.pem',
  // todo don't hardcode this. effectiveConfig.yaml has "iotDataEndpoint", which looks similar to
  //      this url. but it's in the config for the Nucleus component
  host: 'a21gb26zq6ucj0-ats.iot.ap-southeast-2.amazonaws.com'
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
 * Registers the Thing Shadow.
 */
const deviceStart = () => {
  try {  
    // Device thing shadow that reports the device current print status.
    // Thing Shadow document can be checked on AWS IoT Thing console.
    thingShadow = new awsIot.thingShadow(deviceOptions(`${thingName}-shadow`));

    // Registers the Thing Shadow with the Thing name.
    thingShadow.register(thingName);
  } catch (err) {
    console.error(err);
    
    logMessage('Failed', `Failed to start job [${err.message}]`, 'N/A');
  }
};

// Handles local print job submission only. todoc update comment
app.post('/submit', (req, res) => {
  const data = req.body;      
  const printData = urlencode.decode(data.data.replace(/\+/g, '%20'));

  // Check we haven't already received this job. This won't affect local jobs because they don't
  // come with an ID.
  // todo check with haolin to confirm ^
  if (data.id && printJobs.ids.includes(data.id)) {
    logMessage('Success', 'Ignoring duplicate message for print job', data.id);
    res.send({ pass: true });
    return;
  }

  // Local print job has id of -1 for PrintOS.jar.
  // todo add id to the http interface docs. (if there are none, write some)
  const id = data.id || '-1';

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

// todo check slack msgs from haolin about this and add more info/context to these comments, e.g.
//      explain why we need this and what it's currently being used for
// todo move local job code into a separate file? a separate component?
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

// todo comment out manual health check
// todo check whether greengrass fully replaces manual health check functionality
// todo what should we do with the server end of the health check? just delete it? is it used for
//      anything else? probably talk to haolin about it
// todo put `nvm use` in the README
// todo change the name "print-client"? maybe just use the old name "printos-local-server"
// todo need to create a policy for each device like provision.js does?
// todo does stdout and stderr from this app and from PrintOS.jar end up in the right place
//      (somewhere in AWS, i assume)
// todo try using an on-demand lambda that runs when the device receives an MQTT message:
//      https://docs.aws.amazon.com/greengrass/v2/developerguide/import-lambda-function-console.html#import-lambda-console-configure-function-parameters
//      not sure what to do with the local HTTP print server stuff then, though. maybe split that
//      out into a separate GG component?
// todo push all this to a WIP branch/repo? (and link it in a comment on the ticket)
// todo rename io.datapos.PrintClient to io.datapos.ReceiptPrinterMQTTInterface and call the HTTP
//      component io.datapos.ReceiptPrinterHTTPInterface
// todo make print-greengrass a branch of print-provision instead of a separate repo. (won't lose
//      the history that way)
const startHealthCheck = async () => {
  try{ 
    console.log('Reporting health...');

    // Allow auth cookies to be passed.
    const transport = axios.create({
      withCredentials: true
    });

    const dataposApiUrl = args.dataposApiUrl;
    const vendorUsername = args.vendorUsername;
    const vendorPassword = args.vendorPassword;

    const params = new URLSearchParams();
    params.append('username', vendorUsername);
    params.append('password', vendorPassword);

    const response = await axios.post(`${dataposApiUrl}/v1/current-vendor/login`, params);

    const authCookie = response.headers['set-cookie'][0];

    const hcResponse = await axios.post(`${dataposApiUrl}/v1/current-vendor/external-service/status`, {
      externalService: {
        serviceVendorUser: vendorUsername,
        serviceType: `print-${thingName}`,
        serviceVersion: serviceVersion
      },
      status: lastHealthStatus.status,
      message: lastHealthStatus.message,
      lastSuccessId: lastHealthStatus.printJobId && lastHealthStatus.printJobId.toString(),
      lastSuccessTime: new Date().toISOString()
    }, {
      headers: {
        Cookie: authCookie,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('Failed to report health', err.message);
    console.error(err.response.data);
    console.error(err.response.status);
    console.error(err.response.headers);
  }
};

const healthHeartBeatInterval = 60 * 1000;

// todo delete this (pretty sure). make the server robust to network drop outs? local jobs should
//      still work while offline, right?
const checkInternetAndStart = () => {
  // Check for internet before we start the device connection.
  require('dns').resolve('www.google.com', (err) => {
    if (err) {
      console.log('No internet connection', err);

      // Wait and check again.
      setTimeout(checkInternetAndStart, 3000);
    } else {
      console.log('Internet is connected');

      setInterval(startHealthCheck, healthHeartBeatInterval);

      // Start the device for jobs.
      deviceStart();
    }
  });
};

// todo delete
console.log(JSON.stringify(process.env));

// todo delete. systemd won't start greengrass until network is up (not necessarily connected
//      though). haven't seen an explanation for why the device needed 10 seconds to "settle"
//      before.
// Delay 10 seconds before start this for system to settle down.
//const startDelay = 10 * 1000;

//setTimeout(checkInternetAndStart, startDelay);
// Start the device for jobs.
deviceStart();

// Start the server.
app.listen(8083);
