#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

function fail
{
	echo $@ >&2
	exit 1
}

dc_tmpdir=/var/tmp/devcloud.$$
mkdir $dc_tmpdir || fail "failed to create tmpdir"
echo using tmpdir $dc_tmpdir

export CA_AMQP_PREFIX=cadev
export $($(dirname $0)/npath)

node cmd/castashsvc.js $dc_tmpdir/stash > $dc_tmpdir/stash.out 2>&1 &
echo castashsvc = $!
node cmd/caaggsvc.js > $dc_tmpdir/agg.out 2>&1 &
echo caaggsvc = $!
node cmd/cainstsvc.js > $dc_tmpdir/inst.out 2>&1 &
echo cainstsvc = $!
node cmd/caconfigsvc.js > $dc_tmpdir/config.out 2>&1 &
echo caconfigsvc = $!
