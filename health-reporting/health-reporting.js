const awsIot = require('aws-iot-device-sdk');
const axios = require('axios');

/** The duration in milliseconds between reporting the device status to core-services. */
const healthHeartBeatInterval = 60 * 1000;

/** The name of this IoT Thing (i.e. device, e.g. a Raspberry Pi) in AWS. */
const thingName = process.env.AWS_IOT_THING_NAME;

let lastHealthStatus = {};

let thingShadow = undefined;

const deviceOptions = (clientId, mqttEndpointAddress) => ({
    clientId,
    // The README tells you to install to /greengrass/v2, so these paths should work.
    keyPath: '/greengrass/v2/privKey.key',
    certPath: '/greengrass/v2/thingCert.crt',
    caPath: '/greengrass/v2/rootCA.pem',
    host: mqttEndpointAddress
});

/**
 * @param {string} componentVersion The version string of the Greengrass component.
 * @param {string} message The message to log.
 * @param {string?} printJobId The ID of the associated print job. Optional.
 */
exports.log = (componentVersion, message, printJobId) => {
    console.log(JSON.stringify({
        componentVersion,
        lastHealthStatus: lastHealthStatus.status,
        printJobId: printJobId || 'N/A',
        message
    }));
};

/**
 * Set the latest the health status data and log it. The health status is reported to Core Services
 * regularly.
 *
 * @param {string} componentVersion The version string of the Greengrass component.
 * @param {string} status of the message represents: Success or Failed.
 * @param {string} message to be logged and reported.
 * @param {string?} printJobId id of the print job. Optional.
 */
exports.updateHealthStatus = (componentVersion, status, message, printJobId) => {
    lastHealthStatus = {
        status,
        message,
        printJobId: printJobId || 'N/A',
    };

    // Updates the Thing Shadow's state, reports current device's status.
    // TODO: From the docs, it seems likely that `update` won't retry if there's a temporary network
    //       issue or some failure like that. The simplest fix might be to try to update the shadow in
    //       `reportHealthCheck` as well.
    // todo use different named shadows for mqtt and http so they don't overwrite each other's shadow data. will need to upgrade to the v2 sdk.
    thingShadow && thingShadow.update(thingName, {
        state: {
            reported: lastHealthStatus
        }
    });

    exports.log(componentVersion, printJobId, message);
};

/**
 * Create and register the Thing Shadow, which records the most recent print status for the device.
 *
 * The Thing Shadow document can be checked in the AWS IoT Thing console. It will likely be under
 * the name "Classic Shadow".

 * @see https://docs.aws.amazon.com/iot/latest/developerguide/iot-device-shadows.html
 */
const setUpThingShadow = (componentShortName, componentVersion, mqttEndpointAddress) => {
    try {
        // Device thing shadow that reports the device current print status.
        thingShadow = new awsIot.thingShadow(
            deviceOptions(`${thingName}-shadow-${componentShortName}`, mqttEndpointAddress));

        // Registers the Thing Shadow with the Thing name.
        thingShadow.register(thingName);
    } catch (err) {
        console.error(err);

        exports.updateHealthStatus(
            componentVersion, 'Failed', `Failed to create Thing Shadow [${err.message}]`);
    }
};

/** Report the current health status to the DataPOS API. */
const reportHealthCheck =
    (componentShortName, componentVersion, dataposApiUrl, vendorUsername, vendorPassword) =>
        async () => {
            try {
                exports.log(componentVersion, 'Reporting health...');

                // Allow auth cookies to be passed.
                axios.create({withCredentials: true});

                // Authenticate with the vendor credentials.
                const params = new URLSearchParams();
                params.append('username', vendorUsername);
                params.append('password', vendorPassword);

                const response = await axios.post(
                    `${dataposApiUrl}/v1/current-vendor/login`, params);

                const authCookie = response.headers['set-cookie'][0];

                // If any of the fields are undefined, the request will fail with a 400 error, so
                // default to success.
                const data = {
                    externalService: {
                        serviceVendorUser: vendorUsername,
                        serviceType: `print-${thingName}-${componentShortName}`,
                        serviceVersion: componentVersion
                    },
                    status: lastHealthStatus.status || 'Success',
                    message: lastHealthStatus.message || '',
                    lastSuccessId: lastHealthStatus.printJobId ?
                        lastHealthStatus.printJobId.toString() : "",
                    lastSuccessTime: new Date().toISOString()
                };

                exports.log(componentVersion, `Health report data: ${JSON.stringify(data)}`);

                const hcResponse =
                    await axios.post(`${dataposApiUrl}/v1/current-vendor/external-service/status`,
                        data,
                        {
                            headers: {
                                Cookie: authCookie,
                                'Content-Type': 'application/json'
                            }
                        });

                exports.log(componentVersion,
                    `Successfully reported health. Response: ${JSON.stringify(hcResponse.data)}`);
            } catch (err) {
                console.error('Failed to report health', err.message);
                console.error(err);
                console.dir(err.response);
            }
        };

/**
 * Start reporting the device's health every `healthHeartBeatInterval` ms. It's reported to the
 * DataPOS server applications through the Public API and stored in a device shadow in AWS IoT.
 *
 * The device shadow gives us a way to view the most recent health status for a device without
 * having to search through the logs. The data is also sent to the cloud sooner. The logs only get
 * sent when the log file is rotated out. (Actually, they're not set at all yet, but it's planned.)
 *
 * The shadows aren't currently read by any software. We just check them manually in the AWS
 * console. Go to <https://console.aws.amazon.com/iot/home#/thinghub>, select a device, then click
 * "Shadows".
 */
exports.startReporting =
    (componentShortName,
     componentVersion,
     dataposApiUrl,
     vendorUsername,
     vendorPassword,
     mqttEndpointAddress) => {
        setUpThingShadow(componentShortName, componentVersion, mqttEndpointAddress);

        setInterval(
            reportHealthCheck(
                componentShortName, componentVersion, dataposApiUrl, vendorUsername, vendorPassword),
            healthHeartBeatInterval);
    };
