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
# Tests caSaveFile
#

source ../catestlib.sh

tr_tmpdir=/var/tmp/$(basename $0).$$

function runtest
{
	local func filename data
	func=$1
	arg1=$2
	arg2=$3

	cat > $tr_tmpdir/script <<EOF
	var mod_capersist = require('$SRC/lib/ca/ca-persist');

	mod_capersist.$func('$arg1', '$arg2', function (err) {
		if (err)
			throw (err);
	});
EOF

	$NODE_EXEC $tr_tmpdir/script
	return $?
}

echo "using tmpdir $tr_tmpdir"
mkdir $tr_tmpdir || tl_fail "failed to create tmpdir"

echo "TEST: write copy of /usr/dict/words"
contents=$(cat /usr/dict/words | tr "\n'" '  ') || \
    tl_fail "failed to read /usr/dict/words"
runtest caSaveFile $tr_tmpdir/tmpfile "$contents" || \
    tl_fail "failed to save file"
[[ -f $tr_tmpdir/tmpfile ]] || tl_fail "failed to create file"

#
# We can't just diff the files since we transliterated newlines and quotes to
# spaces, but we can check the size.
#
osz=$(wc -c /usr/dict/words | awk '{print $1}')
nsz=$(wc -c $tr_tmpdir/tmpfile | awk '{print $1}')
[[ $osz -eq $nsz ]] || \
    tl_fail "/usr/dict/words and $tr_tmpdir/tmpfile have different sizes"

#
# Try rewriting the same file again.  It should work.
#
echo "TEST: rewrite file again"
runtest caSaveFile $tr_tmpdir/tmpfile "foo" || \
    tl_fail "failed to create new file"
nsz=$(wc -c $tr_tmpdir/tmpfile | awk '{print $1}')
[[ $nsz -eq 3 ]] || tl_fail "rewrite didn't work"

#
# Try rewriting to a non-existent directory
#
echo "TEST: write to non-existent directory"
runtest caSaveFile $tr_tmpdir/foo/bar "foo" > /dev/null 2>&1 && \
    tl_fail "expected failure"
[[ -e $tr_tmpdir/foo ]] && tl_fail "directory created"

#
# Rename a file or directory
#
echo "TEST: rename"
runtest caRename $tr_tmpdir/tmpfile $tr_tmpdir/tmpfile2 || \
    tl_fail "failed to rename file"
[[ -e $tr_tmpdir/tmpfile ]] && tl_fail "old file still exists"
[[ -e $tr_tmpdir/tmpfile2 ]] || tl_fail "new file doesn't exist"

rm -rf $tr_tmpdir
exit 0
