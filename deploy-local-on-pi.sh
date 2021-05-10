#!/usr/bin/env bash

#
# deploy-local-on-pi.sh
#
# Deploys the Greengrass components locally on the Pi for testing.
#
# After running this script, you can check the logs with
#     sudo tail -f /greengrass/v2/logs/io.datapos.ReceiptPrinterHTTPInterface.log \
#       -f /greengrass/v2/logs/io.datapos.ReceiptPrinter.log \
#       -f /greengrass/v2/logs/greengrass.log
#
# It can take a few minutes for the new deployments to start up.
#

# todo add ReceiptPrinterMQTTInterface to this script

# Check this script is running on the Pi.
function fail {
    echo "Run this on the Raspberry Pi." > /dev/stderr
    exit 1
}
uname -a | grep raspberrypi > /dev/null || fail

# Print the commands as they run.
set -x

# Remove the previous deployments (if any).
# todo not sure we actually need to do this

sudo /greengrass/v2/bin/greengrass-cli deployment create \
        --remove "io.datapos.ReceiptPrinterHTTPInterface"

sudo /greengrass/v2/bin/greengrass-cli deployment create \
        --remove "io.datapos.ReceiptPrinter"

# Deploy the components.

sudo /greengrass/v2/bin/greengrass-cli deployment create \
        --recipeDir ~/print-greengrass/recipes \
        --artifactDir ~/print-greengrass/artifacts \
        --merge "io.datapos.ReceiptPrinterHTTPInterface=1.0.0"

sudo /greengrass/v2/bin/greengrass-cli deployment create \
        --recipeDir ~/print-greengrass/recipes \
        --artifactDir ~/print-greengrass/artifacts \
        --merge "io.datapos.ReceiptPrinter=1.0.0"
