const awsIot = require('aws-iot-device-sdk-v2');
const axios = require('axios');

/** The duration in milliseconds between reporting the device status to core-services. */
const healthHeartBeatInterval = 60 * 1000;

/** The name of this IoT Thing (i.e. device, e.g. a Raspberry Pi) in AWS. */
const thingName = process.env.AWS_IOT_THING_NAME;

let lastHealthStatus = {};

/** Used to update the Thing Shadow in AWS IoT. */
let shadowClient = undefined;

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
 * @param {string} componentShortName A short name to identify the Greengrass component. Included in
 *                 the name of the Thing Shadow.
 * @param {string} componentVersion The version string of the Greengrass component.
 * @param {string} status of the message represents: Success or Failed.
 * @param {string} message to be logged and reported.
 * @param {string?} printJobId id of the print job. Optional.
 */
exports.updateHealthStatus = async (componentShortName, componentVersion, status, message, printJobId) => {
    lastHealthStatus = {
        status,
        message,
        printJobId: printJobId || 'N/A',
    };

    exports.log(componentVersion, message, printJobId);

    // Update the Thing Shadow's state to store current device's status.
    if (shadowClient) {
        await shadowClient.publishUpdateNamedShadow({
                thingName,
                shadowName: `${componentShortName}-health`,
                state: {
                    reported: lastHealthStatus
                }
            },
            // If the message fails, retry until it succeeds. It's OK if the other end receives
            // duplicates because updating a shadow is idempotent.
            awsIot.mqtt.QoS.AtLeastOnce);
    }
};

/**
 * Initialise `shadowClient`, which we use to update the Thing Shadow to record the most recent
 * print status for the component. You can check the Thing Shadow document in the AWS IoT Thing
 * console.
 *
 * @see awsIot.iotshadow.IotShadowClient
 * @see https://docs.aws.amazon.com/iot/latest/developerguide/iot-device-shadows.html
 */
const setUpThingShadow = async (componentShortName, componentVersion, mqttEndpointAddress) => {
    try {
        // Create an MQTT connection to the AWS IoT service.
        const builder = awsIot.iot.AwsIotMqttConnectionConfigBuilder.new_mtls_builder_from_path(
            // The README tells you to install to /greengrass/v2 and the docs say that these
            // certs/keys will be in the install dir with these filenames, so these paths should
            // work. The same goes for rootCA.pem below.
            '/greengrass/v2/thingCert.crt',
            '/greengrass/v2/privKey.key');

        builder.with_certificate_authority_from_path(undefined, '/greengrass/v2/rootCA.pem');
        builder.with_endpoint(mqttEndpointAddress);
        builder.with_client_id(`${thingName}-${componentShortName}-health`);

        // Send messages queued while offline after reconnecting.
        builder.with_clean_session(false);

        const client = new awsIot.mqtt.MqttClient(new awsIot.io.ClientBootstrap());
        const connection = client.new_connection(builder.build());

        await connection.connect();

        // We'll use this in other functions to store the health data in the shadow.
        shadowClient = new awsIot.iotshadow.IotShadowClient(connection);
    } catch (err) {
        console.error(err);

        await exports.updateHealthStatus(
            componentShortName,
            componentVersion,
            'Failed',
            `Failed to create Thing Shadow [${err.message}]`);
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
                // TODO: Is it possible to log this info (or less) on a single line, preferably as a
                //       JSON object? It takes up a lot of room when the device goes offline.
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
 *
 * @param {string} componentShortName A short name to identify the Greengrass component. Included in
 *                 the name of the Thing Shadow.
 * @param {string} componentVersion The version string of the Greengrass component.
 * @param {string} dataposApiUrl The base URL for the DataPOS Public API (exposed by Core Services).
 * @param {string} vendorUsername The vendor's username for authenticating with the Public API.
 * @param {string} vendorPassword The vendor's password for authenticating with the Public API.
 * @param {string} mqttEndpointAddress The address to connect to the AWS IoT MQTT broker.
 */
exports.startReporting = async (componentShortName,
                                componentVersion,
                                dataposApiUrl,
                                vendorUsername,
                                vendorPassword,
                                mqttEndpointAddress) => {
    await setUpThingShadow(componentShortName, componentVersion, mqttEndpointAddress);

    setInterval(
        reportHealthCheck(
            componentShortName, componentVersion, dataposApiUrl, vendorUsername, vendorPassword),
        healthHeartBeatInterval);
};
