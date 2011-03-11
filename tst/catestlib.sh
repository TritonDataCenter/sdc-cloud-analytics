#!/usr/bin/bash

#
# Common shell functions for automated tests
#

tl_path_svcs="$SRC/cmd"
tl_path_aggsvc="$tl_path_svcs/caaggsvc.js"
tl_path_configsvc="$tl_path_svcs/caconfigsvc.js"
tl_path_instsvc="$tl_path_svcs/cainstsvc.js"

#
# Fail the current test with the specified error message.
#
function tl_fail
{
	echo "$@" >&2
	exit 1
}

#
# Launch one of the "config", "agg", or "inst" services in the background.  The
# pid is saved into $tl_launchpid for use later with tl_killwait.
#
function tl_launchsvc
{
	local svc=$1
	local path

	case $svc in
	config)		path=$tl_path_configsvc ;;
	agg)		path=$tl_path_aggsvc	;;
	inst)		path=$tl_path_inst	;;
	*)		tl_fail "launchsvc: invalid svc: $svc"
			;;
	esac

	[[ -n $NODE_EXEC ]] || tl_fail "launchsvc: NODE_EXEC not set"
	echo "launchsvc: launching $NODE_EXEC $path"
	cd $SRC
	$NODE_EXEC $path &
	cd - > /dev/null
	tl_launchpid=$!
}

#
# Kill the specified child pid and wait the process to exit.
#
function tl_killwait
{
	local pid=$1
	[[ -n $pid ]] || tl_fail "killwait: no pid specified"

	kill -9 $pid
	wait $pid
}
