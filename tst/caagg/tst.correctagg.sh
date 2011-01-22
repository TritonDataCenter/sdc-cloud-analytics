#!/usr/bin/bash

#
# Test that the aggregator correctly combines data. Note, catest always
# guarantees us that we are running from our local directory
#

PATH="/usr/bin"
export PATH=$PATH

AGG_PATH="../../cmd/caaggsvc.js"
AGG_JS="testagg.js"

#
# Global vars:
#
AGGPID=-1

function fatal
{
	echo "$@" >&2
	exit 1
}

#
# Launch the aggregator service and set the pid
#
function launchagg
{
	echo "$NODE_EXEC $AGG_PATH"
	$NODE_EXEC $AGG_PATH &
	AGGPID=$!
}

function killagg
{
	kill -9 $AGGPID
	wait $AGGPID
	return $?
}

function runtest
{
	printf "Running test %s with %d hosts" $1 $2
	launchagg
	$NODE_EXEC $AGG_JS $1 $2
	RET=$?
	killagg
	[[ $RET  == 0 ]] || fatal "Failed test $1/$2 with return code $RET"
}

runtest 'scalar' 1 
runtest 'scalar' 10
runtest 'key-scalar' 1
runtest 'key-scalar' 10
runtest 'key-key-scalar' 1
runtest 'key-key-scalar' 10
runtest 'simple-dist' 10
runtest 'hole-dist' 10
runtest 'key-dist' 10
runtest 'undefined' 1

exit 0
