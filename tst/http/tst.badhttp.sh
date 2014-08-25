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
# Test that the aggregator correctly combines data. Note, catest always
# guarantees us that we are running from our local directory
#

source ../catestlib.sh

BAD_AGG="badagg.js"
BAD_CFG="badconfig.js"

printf "Running test %s\n" $BAD_AGG
tl_launchsvc agg
$NODE_EXEC $BAD_AGG
RET=$?
tl_killwait $tl_launchpid
[[ $RET == 0 ]] || tl_fail "Failed test $BAD_AGG with return code $RET"

printf "Running test %s\n" $BAD_CFG
tl_launchsvc config
$NODE_EXEC $BAD_CFG
RET=$?
tl_killwait $tl_launchpid
[[ $RET == 0 ]] || tl_fail "Failed test $BAD_CFG with return code $RET"
