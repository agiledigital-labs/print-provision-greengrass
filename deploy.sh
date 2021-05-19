#!/usr/bin/env bash

#
# deploy.sh
#
# Deploys the device software (i.e. the components) through AWS.
#
# Usage: deploy.sh [S3 bucket name]
#
# This script will
#  1. Create an S3 bucket with the given name, if it doesn't already exist. (Note that S3 bucket
#     names must be globally unique.)
#  2. Create and attach an IAM policy that allows the devices to read files in the bucket.
#  3. Upload the software artifacts into the S3 bucket so the devices can download and run them.
#  4. Create, in the AWS Greengrass service,
#     - the current version of each component, and
#     - a deployment that deploys those versions to the devices.
#
# Before running this script, edit deployment.yaml:
#  - Change the targetArn field to the ARN of your AWS IoT Thing Group. You can find it at
#    <https://console.aws.amazon.com/iot/home#/thingGroupHub>.
#  - If you're using a real printer, change the io.datapos.ReceiptPrinter > configurationUpdate >
#    merge field to set the name of the printer.
#
# If the current version of any of the components has already been created in the AWS Greengrass
# service, it must be deleted first and removed from the device, e.g. by running this on it:
#
#     # TODO: Test this.
#     sudo /greengrass/v2/bin/greengrass-cli deployment create \
#         --remove io.datapos.ReceiptPrinter \
#         --groupId thinggroup/ReceiptPrinterGroup
#
# See <https://docs.aws.amazon.com/greengrass/v2/developerguide/upload-components.html> and
# <https://docs.aws.amazon.com/greengrass/v2/developerguide/create-deployments.html>.
#

# Bash strict mode. See http://redsymbol.net/articles/unofficial-bash-strict-mode/
set -euo pipefail
IFS=$'\n\t'

# The path to this script file.
script_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# The name of the S3 bucket to store the component artifacts in.
s3_bucket="${1:-}"

# TODO: Also take the targetArn as an arg and use it to replace the hardcoded one in
#       deployment.yaml. Maybe take the name of the printer to use as well.

# The IAM role for the devices.
device_role=ReceiptPrinterGreengrassV2TokenExchangeRole

# The IAM policy that lets the devices read files in the S3 bucket.
device_policy=ReceiptPrinterGreengrassV2ComponentArtifactPolicy

aws_region=ap-southeast-2

work_dir="$(mktemp -d)"

# Check the arguments this script was called with.
function check_args {
    # If called with no args, "-h" or "-?"...
    if [[ -z "${s3_bucket:-}" ]] \
        || [[ "$s3_bucket" == "-h" ]] \
        || [[ "$s3_bucket" == "-?" ]]; then
        # Print out the header from this file, which contains usage instructions.
        # TODO: Make this less cryptic. For now, see <https://stackoverflow.com/a/17353254>.
        tail -n +4 "$script_dir/$0" \
            | awk '/^#/,/^$/;/^$/{exit}' >&2

        # Exit early.
        exit 1
    fi
}

# Check the system has the programs this script uses.
function check_dependencies {
    local missing_deps=false

    if ! which aws >/dev/null; then
        echo "Please install the AWS CLI v2: https://aws.amazon.com/cli/" >&2
        missing_deps=true
    fi

    if ! which jq >/dev/null; then
        echo "Please install jq: https://stedolan.github.io/jq/" >&2
        missing_deps=true
    fi

    if ! which zip >/dev/null; then
        echo "Please install zip, e.g. apt install zip" >&2
        missing_deps=true
    fi

    if [[ $missing_deps == "true" ]]; then
        exit 1
    fi
}

# Create the S3 bucket to hold the artifact files, if it doesn't already exist.
function create_s3_bucket_for_artifacts {
    # Check whether it already exists.
    if aws s3 ls "s3://$s3_bucket" >/dev/null 2>&1; then
        echo "Found S3 bucket '$s3_bucket'"
    else
        # Make the bucket.
        echo "Creating S3 bucket"

        aws s3api create-bucket \
            --bucket "$s3_bucket" \
            --region "$aws_region" \
            --create-bucket-configuration "LocationConstraint=$aws_region"
    fi
}

# Create an IAM policy to allow the devices to read the S3 bucket, if it doesn't already exist.
function create_artifact_policy {
    # Check whether it already exists.
    if aws iam list-attached-role-policies \
        --role-name $device_role | grep -q "$device_policy"; then
        echo "Found IAM policy '$device_policy' attached to role '$device_role'"
    else
        # Make a copy of the policy file and insert the name of the S3 bucket we're using.
        sed "s/S3_BUCKET_NAME/$s3_bucket/g"  "$script_dir/component-artifact-policy.json" \
            > "$work_dir/component-artifact-policy.json"

        # Make the policy.
        echo "Creating IAM policy for the devices to read from S3"

        local policy_arn
        policy_arn=$( \
            aws iam create-policy \
                --policy-name "$device_policy" \
                --policy-document "file://$work_dir/component-artifact-policy.json" \
            | jq --raw-output '.Policy.Arn')

        # Check it worked.
        [[ "$policy_arn" != "" ]] || exit 1

        # Attach it to the role that the devices use.
        echo "Attaching the policy '$policy_arn' to the role '$device_role'"

        aws iam attach-role-policy \
            --role-name "$device_role" \
            --policy-arn "$policy_arn"
    fi
}

# Upload the artifact files for a component into the S3 bucket.
# Params:
#  - The name of the component.
#  - The version of the component.
function upload_artifacts_to_s3 {
    local component_name="$1"
    local component_version="$2"

    # Make the zip file to upload.
    artifacts_path="artifacts/$component_name/$component_version"
    zip_path="$work_dir/$component_name-$component_version-artifact.zip"

    echo "Archiving the artifact files for $component_name (version $component_version)"
    cd "$script_dir/$artifacts_path"
    zip --quiet --recurse-paths "$zip_path" .
    cd -

    # Upload to S3.
    echo "Uploading the archive to S3"
    aws s3 cp "$zip_path" "s3://$s3_bucket/$artifacts_path/artifact.zip"

    # Clean up.
    rm "$zip_path"
}

# Create a new component in the AWS Greengrass service.
# Uploads the artifact files and then creates the component from the component's recipe file.
# todo explain that the same version of the component can't already exist, but other versions can
# Params:
#  - The name of the component.
#  - The version of the component.
function create_component_in_greengrass {
    local component_name="$1"
    local component_version="$2"

    # Upload the component's artifacts (i.e. files) to S3 so the devices can get them.
    upload_artifacts_to_s3 "$component_name" "$component_version"

    # Make a copy of the component's recipe file and insert the name of the S3 bucket we're using.
    recipe_filename="$component_name-$component_version.yaml"

    sed "s/S3_BUCKET_NAME/$s3_bucket/g" "$script_dir/recipes/$recipe_filename" \
        > "$work_dir/$recipe_filename"

    # Create the component.
    echo "Creating component $component_name version $component_version in Greengrass"

    local output
    output="$( \
        aws greengrassv2 create-component-version \
            --inline-recipe "fileb://$work_dir/$recipe_filename" \
            | tee /dev/tty)"  # Also print the output.

    # Wait until the component is ready.
    local arn
    arn="$(echo "$output" | jq --raw-output '.arn')"
    [[ "$arn" != "" ]] || exit 1

    echo "Waiting for the component to become ready for deployment..."

    wait_until_component_ready "$arn"
}

# Params:
#  - The ARN of the component to wait for.
function wait_until_component_ready {
    local arn="$1"
    local ready="false"
    local desc

    while [[ $ready != "true" ]]; do
        desc="$(aws greengrassv2 describe-component --arn "$arn")"

        # Check for errors.
        if [[ "$(echo "$desc" | jq '.status.errors | length')" != "0" ]]; then
            echo "Errors reported." >&2
            echo "$desc" >&2
            exit 1
        fi

        # Check whether it's ready yet.
        if [[ "$(echo "$desc" | jq --raw-output '.status.componentState')" == "DEPLOYABLE" ]]; then
            ready=true
        else
            echo "..."
            sleep 1
        fi
    done
}

function create_deployment_in_greengrass {
    echo "Deploying the components"

    # Create the new deployment and get its ID from the output.
    local deployment_id
    deployment_id="$( \
        aws greengrassv2 create-deployment \
            --cli-input-yaml "file://$script_dir/deployment.yaml" \
        | jq --raw-output '.deploymentId')"
        
    # Print out the details of the deployment.
    echo "Created deployment $deployment_id:"

    aws greengrassv2 get-deployment \
        --deployment-id "$deployment_id"
}

function main {
    # Clean up at the end.
    trap 'rm -rf "$work_dir"' EXIT

    # Check the script can run.
    check_args
    check_dependencies

    # Make the S3 bucket for the component artifacts and the policy that lets the devices download
    # them (unless they already exist).
    create_s3_bucket_for_artifacts
    create_artifact_policy

    # Create each component.
    # todo read the version numbers from deployment.yaml or take them as options
    create_component_in_greengrass io.datapos.ReceiptPrinter 1.0.0
    create_component_in_greengrass io.datapos.ReceiptPrinterHTTPInterface 1.0.0
    create_component_in_greengrass io.datapos.ReceiptPrinterMQTTInterface 1.0.0

    # Deploy the components to the devices.
    create_deployment_in_greengrass

    echo "Done"
}

main
