#!/usr/bin/env bash

#
# deploy-local-on-pi.sh
#
# Deploys the Greengrass components locally on the Pi for testing. See README.md for instructions
# for deploying locally.
#
# Options:
#  -r Deploy the io.datapos.ReceiptPrinter component.
#  -h Deploy the io.datapos.ReceiptPrinterHTTPInterface component.
#  -m Deploy the io.datapos.ReceiptPrinterMQTTInterface component.
#  The default (i.e. no opts) is to deploy all components.
#

# The versions of the components to deploy.
# TODO: Should we read these from deployment.yaml? Or maybe from env vars or take them as options?
receipt_printer_version=1.0.0
mqtt_interface_version=1.0.0
http_interface_version=1.0.0

# The path to this script file.
script_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Exit with failure.
# Params:
#  - An error message.
function fail {
    echo "$1" > /dev/stderr
    exit 1
}

# Check this script is running on the Pi.
uname -a | grep raspberrypi > /dev/null || fail "Run this on the Raspberry Pi."

# Check `zip` is installed.
which zip > /dev/null \
    || fail "Please install zip, e.g. sudo apt update && sudo apt install zip"

# Read the opts.
while getopts "rhm" opt; do
    case "$opt" in
        r) deploy_receipt_printer=true ;;
        h) deploy_http_interface=true ;;
        m) deploy_mqtt_interface=true ;;
        *) fail "See the header comment and README.md for usage instructions." ;;
    esac
done

# Deploy all by default.
if [[ "$OPTIND" -eq 1 ]]; then
    deploy_receipt_printer=true
    deploy_http_interface=true
    deploy_mqtt_interface=true
fi

# Put the artifacts in a zip file.
# Params:
#  - The name of the component.
#  - The version of the component.
function zip_artifacts {
    local component_name="$1"
    local component_version="$2"

    local artifacts_dir="$script_dir/artifacts/$component_name/$component_version"

    echo "Zipping $artifacts_dir"
    cd "$artifacts_dir" || fail "Failed to cd into $artifacts_dir"

    # If there's an old one, delete it first.
    rm -f artifact.zip

    # Make the zip.
    zip --quiet --recurse-paths --compression-method=store artifact.zip . \
        || fail "Couldn't zip the artifact files for $component_name $component_version in $(pwd)"
}

# These will hold the arguments to the commands that remove the old deployments and create the new
# ones. We create the local deployment in a single command so we don't have to make one for each
# component, which would be slower and add unnecessary complexity.
remove_args=""
create_args=""

# Add the components we're going to deploy and make artifact.zip files for them.
if [[ "$deploy_http_interface" == "true" ]]; then
    remove_args="$remove_args,io.datapos.ReceiptPrinterHTTPInterface"
    create_args="$create_args \
        --merge io.datapos.ReceiptPrinterHTTPInterface=$http_interface_version"
    zip_artifacts io.datapos.ReceiptPrinterHTTPInterface $http_interface_version
fi

if [[ "$deploy_mqtt_interface" == "true" ]]; then
    remove_args="$remove_args,io.datapos.ReceiptPrinterMQTTInterface"
    create_args="$create_args \
        --merge io.datapos.ReceiptPrinterMQTTInterface=$mqtt_interface_version"
    zip_artifacts io.datapos.ReceiptPrinterMQTTInterface $mqtt_interface_version
fi

if [[ "$deploy_receipt_printer" == "true" ]]; then
    remove_args="$remove_args,io.datapos.ReceiptPrinter"
    create_args="$create_args \
        --merge io.datapos.ReceiptPrinter=$receipt_printer_version"
    zip_artifacts io.datapos.ReceiptPrinter $receipt_printer_version
fi

# Remove the leading comma.
remove_args="${remove_args#,}"

# If the any of the components are already deployed locally to this device, remove them first. The
# new versions don't always seem to get deployed otherwise.
echo "Removing previous local deployments of the components (if any)"
(set -x
    sudo /greengrass/v2/bin/greengrass-cli deployment create --remove "$remove_args")

# Deploy the components.
echo "Deploying the components locally"
(set -x
    # TODO: It might be worth reading the configurationUpdate fields for each component from
    #       deployment.yaml and then using --update-config to apply them in this command. Then you
    #       wouldn't have to remember to edit that config in the recipes instead for local
    #       deployments.
    # shellcheck disable=SC2086 # create_args contains multiple arguments.
    sudo /greengrass/v2/bin/greengrass-cli deployment create \
        --recipeDir "$script_dir/recipes" \
        --artifactDir "$script_dir/artifacts" \
        $create_args)
