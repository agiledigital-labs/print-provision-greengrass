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
uname -a | grep raspberrypi > /dev/null || fail "Run this on your Raspberry Pi."

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

    local artifacts_dir="$script_dir/artifacts/$component_name"

    echo "Zipping $artifacts_dir"
    cd "$artifacts_dir" || fail "Failed to cd into $artifacts_dir"

    # If there's an old one, delete it first.
    rm -rf "$component_version"

    # Make the zip.
    zip --quiet --recurse-paths --compression-method=store artifact.zip . \
        || fail "Couldn't zip the artifact files for $component_name in $(pwd)"

    # The Greengrass CLI expects it to be in a dir with the version number as its name.
    mkdir -p "$component_version"
    mv artifact.zip "$component_version/artifact.zip"
}

# Prints the currently-deployed components, one per line.
function list_components {
    sudo /greengrass/v2/bin/greengrass-cli component list 2>/dev/null \
        | grep '^Component Name: ' \
        | awk '{ print $3 }'
}

# Poll until Greengrass finishes removing the component.
# Params:
#  - The name of the component.
function wait_until_component_removed {
    local component_name="$1"

    echo -n "Waiting for $component_name to be removed. If this never finishes, you may have "
    echo "deployed $component_name remotely. See README.md to remove it manually."

    local ready="false"
    while [[ $ready != "true" ]]; do
        # Get the current list of components.
        components_list="$(list_components)"

        # Check whether the component has been removed from the list.
        ready="true"
        for name_in_list in $components_list; do
            if [[ "$name_in_list" == "$component_name" ]]; then
                ready="false"
            fi
        done

        if [[ $ready != "true" ]]; then
            echo -n "."
            sleep 1
        fi
    done
    echo
}

# If the component is already deployed locally to this device, remove it first. The new version
# doesn't always seem to get deployed otherwise.
# Params:
#  - The name of the component.
function remove_component {
    local component_name="$1"

    echo "Removing previous local deployment of $component_name (if any)"

    sudo /greengrass/v2/bin/greengrass-cli deployment create \
        --remove "$component_name" 2>/dev/null

    wait_until_component_removed "$component_name"
}

# This will hold the arguments to the command that creates the new deployment. We create the local
# deployment in a single command so we don't have to make a separate deployment for each component,
# which would be slower and add unnecessary complexity.
create_args=""

# Add the component to the list to be deployed, make an artifact.zip for it and remove the
# currently-deployed version if there is one.
# Params:
#  - The name of the component.
#  - The version of the component.
function prepare_to_deploy {
    local component_name="$1"
    local component_version="$2"

    create_args="$create_args --merge ${component_name}=${component_version}"
    remove_component "$component_name"
    zip_artifacts "$component_name" "$component_version"
}

# Prepare each component.
if [[ "$deploy_receipt_printer" == "true" ]]; then
    prepare_to_deploy "io.datapos.ReceiptPrinter" "$receipt_printer_version"
fi

if [[ "$deploy_mqtt_interface" == "true" ]]; then
    prepare_to_deploy "io.datapos.ReceiptPrinterMQTTInterface" "$mqtt_interface_version"
fi

if [[ "$deploy_http_interface" == "true" ]]; then
    prepare_to_deploy "io.datapos.ReceiptPrinterHTTPInterface" "$http_interface_version"
fi

# Deploy the components.
echo "Deploying the components locally"
(set -x
    # TODO: It might be worth reading the configurationUpdate fields for each component from
    #       deployment.yaml and then using --update-config to apply them in this command. Then you
    #       wouldn't have to remember to edit that config in the recipes instead for local
    #       deployments.
    #       If not, we should use --update-config to reset all of the configs. Otherwise, any
    #       changes you make to the defaults in the recipes will be ignored if you've deployed the
    #       component on the device before.
    # shellcheck disable=SC2086 # create_args contains multiple arguments.
    sudo /greengrass/v2/bin/greengrass-cli deployment create \
        --recipeDir "$script_dir/recipes" \
        --artifactDir "$script_dir/artifacts" \
        $create_args)

# Poll until it finishes deploying.
echo "Waiting for the components to be deployed."
ready="false"
while [[ $ready != "true" ]]; do
    # Get the current list of components.
    components_list="$(list_components)"

    # Check whether the components are all listed yet.
    ready="true"
    if [[ "$deploy_receipt_printer" == "true" ]] \
        && ! (echo "$components_list" | grep -q '^io.datapos.ReceiptPrinter$'); then
        ready="false"
    fi
    if [[ "$deploy_mqtt_interface" == "true" ]] \
        && ! (echo "$components_list" | grep -q '^io.datapos.ReceiptPrinterMQTTInterface$'); then
        ready="false"
    fi
    if [[ "$deploy_http_interface" == "true" ]] \
        && ! (echo "$components_list" | grep -q '^io.datapos.ReceiptPrinterHTTPInterface$'); then
        ready="false"
    fi

    echo -n "."
done
echo

echo "Done"
