#!/usr/bin/env -S bash -x
rsync -a --info=progress2 --no-inc-recursive ~/datapos/scratch/print-greengrass pi@192.168.10.77:/home/pi/
