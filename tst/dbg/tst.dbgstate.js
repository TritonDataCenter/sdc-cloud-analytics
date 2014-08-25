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

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_dbg = require('../../lib/ca/ca-dbg');

/*
 * Check the global caDbg object vs. exported objects.
 */
ASSERT(caDbg.constructor === mod_dbg.caDebugState);

var dbg = new mod_dbg.caDebugState();
var dbg2 = new mod_dbg.caDebugState();
var ret;

/*
 * Test built-in dumped variables.
 */
ret = JSON.parse(dbg2.dump());
ASSERT('init.time' in ret);
ASSERT('init.time-ms' in ret);
ASSERT(ret['init.time-ms'] == new Date(ret['init.time']).getTime());
delete (ret['init.time']);
delete (ret['init.time-ms']);

mod_assert.deepEqual(ret, {
    'dbg.format-version': 0.1,
    'init.process.argv': process.argv,
    'init.process.pid': process.pid,
    'init.process.cwd': process.cwd(),
    'init.process.env': process.env,
    'init.process.version': process.version,
    'init.process.platform': process.platform
});

/*
 * Test simple sets
 */
dbg.set('nully', null);
dbg.set('undefinedy', undefined);
dbg.set('nullobj', { key: null });
dbg.set('undefinedobj', { key: undefined });
dbg.set('willremove', 10);
dbg.set('wontremove', 12);
dbg.remove('willremove');

/*
 * Test add/remove
 */
ret = dbg.add('file', { file: 1 });
ASSERT(ret == 'file1');
dbg.add('file', { file: 2 });
dbg.remove('file2');
dbg.add('file', { file: 3 });
dbg.add('file', { file: 4 });
dbg.set('file5', { file: 5 });
dbg.add('file', { file: 6 });

/*
 * Throw in a circular reference for kicks.
 */
dbg.set('dbg', dbg.cds_state);

/*
 * Test dump.
 */
ret = JSON.parse(dbg.dump());
delete (ret['init.time']);
delete (ret['init.time-ms']);
console.log(require('sys').inspect(ret, false, null));
mod_assert.deepEqual(ret, {
	nully: null,
	nullobj: { key: null },
	undefinedobj: {},
	wontremove: 12,
	file1: { file: 1 },
	file3: { file: 3 },
	file4: { file: 4 },
	file5: { file: 5 },
	file6: { file: 6 },
	dbg: '<circular>',
	'dbg.format-version': 0.1,
	'init.process.argv': process.argv,
	'init.process.pid': process.pid,
	'init.process.cwd': process.cwd(),
	'init.process.env': process.env,
	'init.process.version': process.version,
	'init.process.platform': process.platform
});

process.exit(0);
