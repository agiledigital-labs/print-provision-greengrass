#!/bin/bash

#
# run.sh
#
# Configures and runs PrintOS.jar, which formats the receipt print jobs and prints them.
#

# Exit with failure.
# Params:
#  - An error message.
function fail {
    echo "Fatal error: $1" > /dev/stderr
    exit 1
}

# Check the env vars are set.
[[ -z "$RECEIPT_PRINTER" ]] && fail "Environment variable RECEIPT_PRINTER must be set."
[[ -z "$AWS_IOT_THING_NAME" ]] && fail "Environment variable AWS_IOT_THING_NAME must be set."
[[ -z "$DESTINATION_PASSWORD" ]] && fail "Environment variable DESTINATION_PASSWORD must be set."
[[ -z "$ARTIFACTS_PATH" ]] && fail "Environment variable ARTIFACTS_PATH must be set."

echo "$0 running in $(pwd)"

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

# Check it worked.
[[ -f PrintOSconfig.ini ]] || fail "Failed to write PrintOSconfig.ini"

# Log success.
echo "Wrote PrintOSconfig.ini:"
cat PrintOSconfig.ini

# PrintOS.jar isn't publicly available, so we provide a mock version of it.
if [[ "$MOCK_PRINTOS_JAR" == "1" ]] || [[ "$MOCK_PRINTOS_JAR" == "true" ]]; then
  echo "Starting the mock version of PrintOS.jar"
  PYTHONPATH='./py_modules' python3 mock-PrintOS.jar.py
else
  # This component is configured to use the real PrintOS.jar, so check that we have it.
  printos_jar="$ARTIFACTS_PATH/PrintOS.jar"
  [[ -f "$printos_jar" ]] || fail "PrintOS.jar not found at $printos_jar"

  # Run PrintOS.jar. It prints the prints jobs with the printer it's configured to use.
  echo "Starting $printos_jar"
  java -jar "$printos_jar"
fi
