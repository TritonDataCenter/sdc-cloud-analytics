#!/usr/bin/bash

#
# Test that the aggregator correctly combines data. Note, catest always
# guarantees us that we are running from our local directory
#

source ../catestlib.sh

TESTS="getmetrics.js insts.js basic.js multi_insts.js"

for test in $TESTS; do
	printf "Running test %s\n" $test
	tl_launchsvc config
	$NODE_EXEC $test
	RET=$?
	tl_killwait $tl_launchpid
	[[ $RET == 0 ]] || tl_fail "failed test $test with return code $ret"
done
