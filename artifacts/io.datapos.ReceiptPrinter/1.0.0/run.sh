#!/bin/bash

#
# run.sh
#
# Configures and runs PrintOS.jar, which formats the receipt print jobs and prints them.
#

# Write out the config file for PrintOS.jar.
#
# Note that the username is called the "destination" in the DB for printos-serverless-service
# and must match the IoT Thing name (i.e. the name of this device in AWS IoT). PrintOS.jar
# needs the username and password so it can report the statuses of the print jobs to
# printos-serverless-service (via the io.datapos.ReceiptPrinterHTTPInterface component).
printos_config_ini="url=http://localhost:8083/lookup
statusURL=http://localhost:8083/update
sleep=1
printer=${RECEIPT_PRINTER}
username=${AWS_IOT_THING_NAME}
password=${DESTINATION_PASSWORD}"

echo "$printos_config_ini" > PrintOSconfig.ini

# Run PrintOS.jar. It prints the prints jobs with the printer it's configured to use.
java -jar "$ARTIFACTS_PATH"/PrintOS.jar
