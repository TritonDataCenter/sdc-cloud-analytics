#!/usr/bin/bash

#
# Test that the aggregator correctly combines data. Note, catest always
# guarantees us that we are running from our local directory
#

PATH="/usr/bin"
export PATH=$PATH

AGG_PATH="../../cmd/caaggsvc.js"
CFG_PATH="../../cmd/caconfigsvc.js"
BAD_AGG="badagg.js"
BAD_CFG="badconfig.js"

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

launchsvc $AGG_PATH
printf "Running test %s" $BAD_AGG
$NODE_EXEC $BAD_AGG
RET=$?
killsvc
[[ $RET  == 0 ]] || fatal "Failed test $BAD_AGG with return code $RET"

launchsvc $CFG_PATH
printf "Running test %s" $BAD_CFG
$NODE_EXEC $BAD_CFG
RET=$?
killsvc
[[ $RET  == 0 ]] || fatal "Failed test $BAD_CFG with return code $RET"

exit 0
