#!/bin/bash

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
