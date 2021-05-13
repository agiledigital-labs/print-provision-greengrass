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
# Options:
#  -r Deploy the io.datapos.ReceiptPrinter component.
#  -h Deploy the io.datapos.ReceiptPrinterHTTPInterface component.
#  -m Deploy the io.datapos.ReceiptPrinterMQTTInterface component.
#  The default (i.e. no opts) is to deploy all components.
#

# todo add ReceiptPrinterMQTTInterface to this script

# Check this script is running on the Pi.
function fail {
    echo "Run this on the Raspberry Pi." > /dev/stderr
    exit 1
}
uname -a | grep raspberrypi > /dev/null || fail

# Read the opts.
while getopts "rhm" opt; do
    case "$opt" in
        r)
            deploy_receipt_printer=true
            ;;
        h)
            deploy_http_interface=true
            ;;
        m)
            deploy_mqtt_interface=true
            ;;
    esac
done

# Deploy all by default.
if [[ "$deploy_receipt_printer" != "true" ]] && \
    [[ "$deploy_http_interface" != "true" ]] && \
    [[ "$deploy_mqtt_interface" != "true" ]]; then
    deploy_receipt_printer=true
    deploy_http_interface=true
    deploy_mqtt_interface=true
fi

# Deploy the components.
#
# Remove the previous deployments (if any) first because, for some reason, the components don't
# always seem to update otherwise.

if [[ "$deploy_http_interface" == "true" ]]; then
    (set -x;
        sudo /greengrass/v2/bin/greengrass-cli deployment create \
                --remove "io.datapos.ReceiptPrinterHTTPInterface";
        sudo /greengrass/v2/bin/greengrass-cli deployment create \
                --recipeDir ~/print-greengrass/recipes \
                --artifactDir ~/print-greengrass/artifacts \
                --merge "io.datapos.ReceiptPrinterHTTPInterface=1.0.0")
fi

if [[ "$deploy_mqtt_interface" == "true" ]]; then
    # todo probably need this first if already deployed through aws
    #      sudo /greengrass/v2/bin/greengrass-cli deployment create --remove \
    #      io.datapos.ReceiptPrinterMQTTInterface --groupId thinggroup/MyGreengrassCoreGroup
    #      might need similar for the other components too
    (set -x;
        sudo /greengrass/v2/bin/greengrass-cli deployment create \
                --remove "io.datapos.ReceiptPrinterMQTTInterface"
        sudo /greengrass/v2/bin/greengrass-cli deployment create \
                --recipeDir ~/print-greengrass/recipes \
                --artifactDir ~/print-greengrass/artifacts \
                --merge "io.datapos.ReceiptPrinterMQTTInterface=1.0.0")
fi

if [[ "$deploy_receipt_printer" == "true" ]]; then
    (set -x;
        sudo /greengrass/v2/bin/greengrass-cli deployment create \
                --remove "io.datapos.ReceiptPrinter"
        sudo /greengrass/v2/bin/greengrass-cli deployment create \
                --recipeDir ~/print-greengrass/recipes \
                --artifactDir ~/print-greengrass/artifacts \
                --merge "io.datapos.ReceiptPrinter=1.0.0")
fi
