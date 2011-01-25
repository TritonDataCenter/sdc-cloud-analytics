#!/usr/bin/bash

#
# Test that the aggregator correctly combines data. Note, catest always
# guarantees us that we are running from our local directory
#

source ../catestlib.sh

GET_METRICS="getmetrics.js"
INST_HTTP="insts.js"

printf "Running test %s\n" $GET_METRICS
tl_launchsvc config
$NODE_EXEC $GET_METRICS
RET=$?
tl_killwait $tl_launchpid
[[ $RET  == 0 ]] || tl_fail "Failed test $GET_METRICS with return code $RET"

printf "Running test %s\n" $INST_HTTP
tl_launchsvc config
$NODE_EXEC $INST_HTTP
RET=$?
tl_killwait $tl_launchpid
[[ $RET  == 0 ]] || tl_fail "Failed test $INST_HTTP with return code $RET"
