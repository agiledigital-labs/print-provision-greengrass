#!/bin/bash

#
# run.sh
# Runs PrintOS.jar, which formats the receipt print jobs and prints them.
#

# Make the PrintOSconfig.ini file, which holds the configuration for PrintOS.jar.
destination="$1"
destination_password="$2"
printer="$3"

printos_config_ini="url=http://localhost:8083/lookup
statusURL=http://localhost:8083/update
sleep=1
printer=${printer}
username=${destination}
password=${destination_password}"

echo "$printos_config_ini" > PrintOSconfig.ini

# Run PrintOS.jar. It prints the prints jobs with the printer it's configured to use.
java -jar PrintOS.jar
