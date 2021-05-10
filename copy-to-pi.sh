#!/usr/bin/env -S bash -x
# shellcheck disable=SC2096

# todo fix the hardcoded parts
rsync --archive --delete --info=progress2 --no-inc-recursive \
    ~/datapos/scratch/print-greengrass \
    pi@192.168.10.77:/home/pi/
