#!/bin/bash

#
# run.sh
#
# Configures and runs PrintOS.jar, which formats the receipt print jobs and prints them.
#

# Write out the config file for PrintOS.jar.
printos_config_ini="url=http://localhost:8083/lookup
statusURL=http://localhost:8083/update
sleep=1
printer=${RECEIPT_PRINTER}
username=${DESTINATION_USERNAME}
password=${DESTINATION_PASSWORD}"

echo "$printos_config_ini" > PrintOSconfig.ini

# Run PrintOS.jar. It prints the prints jobs with the printer it's configured to use.
java -jar "$ARTIFACTS_PATH"/PrintOS.jar
