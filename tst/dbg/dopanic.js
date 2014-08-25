/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests the caDbg object.
 */

var mod_dbg = require('../../lib/ca/ca-dbg');
var mod_tl = require('../../lib/tst/ca-test');

mod_tl.ctSetTimeout(10 * 1000); /* 10s */

mod_dbg.caEnablePanicOnCrash();
setTimeout(function () { throw new Error('SYNTAX ERROR !!!'); }, 500);
