#!/usr/bin/bash

#
# Test that the aggregator correctly combines data. Note, catest always
# guarantees us that we are running from our local directory
#

source ../catestlib.sh

AGG_JS="testagg.js"

function runtest
{
	printf "Running test %s with %d hosts\n" $1 $2
	tl_launchsvc agg
	$NODE_EXEC $AGG_JS $1 $2
	RET=$?
	tl_killwait $tl_launchpid
	[[ $RET == 0 ]] || tl_fail "Failed test $1/$2 with return code $RET"
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
