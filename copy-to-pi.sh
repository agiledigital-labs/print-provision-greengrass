#!/usr/bin/env bash

# The path to this script file.
script_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Print the rsync command.
set -x

# Copy the project dir to the Pi.
#
# Exclude health-reporting/node_modules because health-reporting depends on aws-crt, which doesn't
# support cross compilation, so you have to compile it on the Pi. It takes ages, so we don't want to
# have to do it every time we run this script.
rsync --archive --delete --info=progress2 --no-inc-recursive --exclude=scratch \
    --exclude=health-reporting/node_modules \
    "$script_dir" pi@raspberrypi.local:/home/pi/
