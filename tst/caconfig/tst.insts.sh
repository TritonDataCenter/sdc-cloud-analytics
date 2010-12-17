#!/usr/bin/bash

#
# Test that the aggregator correctly combines data. Note, catest always
# guarantees us that we are running from our local directory
#

PATH="/usr/bin"
export PATH=$PATH

CFG_PATH="../../cmd/caconfigsvc.js"
GET_METRICS="getmetrics.js"
INST_HTTP="insts.js"

#
# Global vars:
#
PID=-1

function fatal
{
	echo "$@" >&2
	exit 1
}

#
# Launch the service and set the pid
#
function launchsvc
{
	$NODE_EXEC $1 &
	PID=$!
	sleep 1
}

function killsvc
{
	kill -9 $PID
	wait $PID
	return $?
}

launchsvc $CFG_PATH
printf "Running test %s" $GET_METRICS
$NODE_EXEC $GET_METRICS
RET=$?
killsvc
[[ $RET  == 0 ]] || fatal "Failed test $GET_METRICS with return code $RET"

launchsvc $CFG_PATH
printf "Running test %s" $INST_HTTP
$NODE_EXEC $INST_HTTP
RET=$?
killsvc
[[ $RET  == 0 ]] || fatal "Failed test $INST_HTTP with return code $RET"

exit 0
