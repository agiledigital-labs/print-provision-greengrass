#!/usr/bin/env bash

# The path to this script file.
script_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Print the rsync command.
set -x

# Copy the project dir to the Pi.
rsync --archive --delete --info=progress2 --no-inc-recursive --exclude=scratch \
    "$script_dir" pi@raspberrypi.local:/home/pi/
