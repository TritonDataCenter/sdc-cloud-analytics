/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests adding decompositions using caAddDecompositions.
 */

var mod_assert = require('assert');
var mod_caagg = require('../../lib/ca/ca-agg');
var mod_tl = require('../../lib/tst/ca-test');

var test_cases = [ {
	name: 'both sides empty',
	lhs: {},
	rhs: {},
	res: {}
}, {
	name: 'empty rhs',
	lhs: { hamlet: 10, macbeth: 12 },
	rhs: {},
	res: { hamlet: 10, macbeth: 12 }
}, {
	name: 'empty lhs',
	lhs: {},
	rhs: { hamlet: 10, macbeth: 12 },
	res: { hamlet: 10, macbeth: 12 }
}, {
	name: 'rhs superset',
	lhs: { hamlet: 15},
	rhs: { hamlet: 10, macbeth: 12 },
	res: { hamlet: 25, macbeth: 12 }
}, {
	name: 'lhs superset',
	lhs: { hamlet: 10, macbeth: 12 },
	rhs: { hamlet: 15},
	res: { hamlet: 25, macbeth: 12 }
}, {
	name: 'mixed',
	lhs: { hamlet: 14, macbeth: 16, othello: 47 },
	rhs: { caesar: 8, hamlet: 5, macbeth: 87 },
	res: { hamlet: 19, macbeth: 103, othello: 47, caesar: 8 }
} ];

var ii, test;

for (ii = 0; ii < test_cases.length; ii++) {
	test = test_cases[ii];
	mod_tl.ctStdout.info('test: %s', test['name']);
	mod_assert.deepEqual(test['res'],
	    mod_caagg.caAddDecompositions(test['lhs'], test['rhs']));
}
