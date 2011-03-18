/*
 * Tests the caDbg object.
 */

var mod_dbg = require('../../lib/ca/ca-dbg');
var mod_tl = require('../../lib/tst/ca-test');

mod_tl.ctSetTimeout(10 * 1000); /* 10s */

mod_dbg.caEnablePanicOnCrash();
setTimeout(function () { throw new Error('SYNTAX ERROR !!!'); }, 500);
