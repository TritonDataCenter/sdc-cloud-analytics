#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

# 
# Tests enabling and using the panic subsystem.
# 

source ../catestlib.sh

echo running ./dopanic.js with output redirected to $$.err

$NODE_EXEC ./dopanic.js > /dev/null 2>$$.err &
t_pid=$!
wait $t_pid && tl_fail "dopanic.js returned 0"
[[ -f cacore.$t_pid ]] || tl_fail "no core file generated"

echo generated core cacore.$t_pid
grep "CA PANIC" $$.err > /dev/null || tl_fail "no panic message generated"
json < cacore.$t_pid > /dev/null || tl_fail "failed to parse core file"
grep "panic.time" cacore.$t_pid > /dev/null || tl_fail "core file had no version"

echo "test completed successfully"
echo "removing cacore.$t_pid $$.err"
rm -f cacore.$t_pid $$.err $$.out
exit 0
