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
# Tests caRemove* family of routines
#

source ../catestlib.sh

tr_tmpdir=/var/tmp/$(basename $0).$$

function runtest
{
	local func arg
	func=$1
	arg=$2

	cat > $tr_tmpdir/script <<EOF
	var mod_capersist = require('$SRC/lib/ca/ca-persist');
	var mod_calog = require('$SRC/lib/ca/ca-log');

	var log = new mod_calog.caLog({ out: process.stdout });

	log.info('$func($arg)');
	mod_capersist.$func(log, '$arg', function (err) {
		if (err)
			throw (err);
	});
EOF

	$NODE_EXEC $tr_tmpdir/script
	return $?
}

echo "using tmpdir $tr_tmpdir"
mkdir $tr_tmpdir || tl_fail "failed to create tmpdir"

echo
echo "TEST: caRemoveFile (file)"
touch $tr_tmpdir/testfile || tl_fail "failed to create tmpfile"
[[ -f $tr_tmpdir/testfile ]] || tl_fail "failed to verify tmpfile"
runtest caRemoveFile $tr_tmpdir/testfile || tl_fail "failed to remove file"
[[ -f $tr_tmpdir/testfile ]] && tl_fail "file not removed"

echo
echo "TEST: caRemoveTree (file)"
touch $tr_tmpdir/testfile || tl_fail "failed to create tmpfile"
[[ -f $tr_tmpdir/testfile ]] || tl_fail "failed to verify tmpfile"
runtest caRemoveTree $tr_tmpdir/testfile || tl_fail "failed to remove file"
[[ -f $tr_tmpdir/testfile ]] && tl_fail "file not removed"

echo
echo "TEST: caRemoveFile (empty dir)"
mkdir $tr_tmpdir/tmpdir || tl_fail "failed to create tmpdir"
[[ -d $tr_tmpdir/tmpdir ]] || tl_fail "failed to verify tmpdir"
runtest caRemoveFile $tr_tmpdir/tmpdir && \
    tl_fail "expected failure (are you root and on UFS?)"
[[ -d $tr_tmpdir/tmpdir ]] || \
    tl_fail "directory removed (are you root and on UFS?)"
rmdir $tr_tmpdir/tmpdir

echo
echo "TEST: caRemoveDirectory (file)"
touch $tr_tmpdir/testfile || tl_fail "failed to create tmpfile"
[[ -f $tr_tmpdir/testfile ]] || tl_fail "failed to verify tmpfile"
runtest caRemoveDirectory $tr_tmpdir/testfile && tl_fail "expected failure"
[[ -f $tr_tmpdir/testfile ]] || tl_fail "file not removed"
rm -f $tr_tmpdir/testfile

echo
echo "TEST: caRemoveDirectory (empty dir)"
mkdir $tr_tmpdir/tmpdir || tl_fail "failed to create tmpdir"
[[ -d $tr_tmpdir/tmpdir ]] || tl_fail "failed to verify tmpdir"
runtest caRemoveDirectory $tr_tmpdir/tmpdir || \
    tl_fail "failed to remove tmpdir"
[[ -d $tr_tmpdir/tmpdir ]] && \
    tl_fail "directory not removed"

echo
echo "TEST: caRemoveTree (empty dir)"
mkdir $tr_tmpdir/tmpdir || tl_fail "failed to create tmpdir"
[[ -d $tr_tmpdir/tmpdir ]] || tl_fail "failed to verify tmpdir"
runtest caRemoveTree $tr_tmpdir/tmpdir || \
    tl_fail "failed to remove tmpdir"
[[ -d $tr_tmpdir/tmpdir ]] && \
    tl_fail "directory not removed"

echo
echo "TEST: caRemoveTree (nested dirs)"
mkdir -p $tr_tmpdir/bigdir/nested1/1
ln -s $tr_tmpdir/bigdir/nested2 $tr_tmpdir/bigdir/nested3
touch $tr_tmpdir/bigdir/nested1/1/foo1
touch $tr_tmpdir/bigdir/nested1/1/bar2
mkdir -p $tr_tmpdir/bigdir/nested2/2
touch $tr_tmpdir/bigdir/nested2/2/foo1
touch $tr_tmpdir/bigdir/nested2/2/bar2
nfiles=$(find $tr_tmpdir/bigdir | wc -l)
[[ $nfiles -eq 10 ]] || tl_fail "failed to create tree ($nfiles)"
runtest caRemoveTree $tr_tmpdir/bigdir || \
    tl_fail "failed to remove directory"
[[ -d $tr_tmpdir/bigdir ]] && tl_fail "failed to remove tree"

rm -rf $tr_tmpdir
exit 0
