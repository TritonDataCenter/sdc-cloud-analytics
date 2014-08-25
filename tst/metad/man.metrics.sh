#!/usr/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

#
# Because this test uses probes that require priv dtrace_kernel, we need to make
# sure we run in a zone that has these priveleges. So we'll run this from the
# global zone. So we'll ssh into the global zone and run the test. It's
# important that we preserve the expectation that catest sets up that says we
# run this test from the directory of the test.
#
# This test is not currently run by catest for two reasons that need to be
# addressed:
#
#	- This test requires us to run in the global zone
#	- We need an entry point in node-libdtrace that only does a strcompile
#	and does not ioctl down to the kernel with the dof code. Who knows
#	exactly what happens to it...
#
# We use the man prefix on this test to indicate that it should not be run by
# catest by default. If you would like to run, simply use bash to execute the
# script.
#

. ../catestlib.sh

DTRACE_FILES='../../cmd/cainst/modules/dtrace'
TEST='metriccombos.js'
HEADNODE=10.99.99.7

ssh root@$HEADNODE <<EOF
/zones/$(zonename)/root/$(pwd)/../../tools/ws
cd /zones/$(zonename)/root/$(pwd)
node $TEST
EOF
EXIT=$?
exit $EXIT
