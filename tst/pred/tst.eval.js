/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests caPredEval, evaluating predicates with a given set of values.
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_capred = require('../../lib/ca/ca-pred');
var mod_tl = require('../../lib/tst/ca-test');

var test_cases = [ {
	pred: {},				/* trivial case */
	values: {},
	result: true
}, {
	pred: { eq: ['hostname', 'legs'] },	/* eq: strings, != */
	values: { 'hostname': 'louie' },
	result: false
}, {
	pred: { eq: ['hostname', 'legs'] },	/* eq: strings, == */
	values: { 'hostname': 'legs' },
	result: true
}, {
	pred: { eq: ['pid', 12] },		/* eq: numbers, != */
	values: { 'pid': 15 },
	result: false
}, {
	pred: { eq: ['pid', 12] },		/* eq: numbers, == */
	values: { 'pid': 12 },
	result: true
}, {
	pred: { ne: ['hostname', 'legs'] },	/* ne: strings, != */
	values: { 'hostname': 'louie' },
	result: true
}, {
	pred: { ne: ['hostname', 'legs'] },	/* ne: strings, == */
	values: { 'hostname': 'legs' },
	result: false
}, {
	pred: { ne: ['pid', 12] },		/* ne: numbers, != */
	values: { 'pid': 15 },
	result: true
}, {
	pred: { ne: ['pid', 12] },		/* ne: numbers, == */
	values: { 'pid': 12 },
	result: false
}, {
	pred: { le: ['pid', 10] },		/* le: <, =, > */
	values: { 'pid': 5 },
	result: true
}, {
	pred: { le: ['pid', 10] },
	values: { 'pid': 10 },
	result: true
}, {
	pred: { le: ['pid', 10] },
	values: { 'pid': 15 },
	result: false
}, {
	pred: { lt: ['pid', 10] },		/* lt: <, =, > */
	values: { 'pid': 5 },
	result: true
}, {
	pred: { lt: ['pid', 10] },
	values: { 'pid': 10 },
	result: false
}, {
	pred: { lt: ['pid', 10] },
	values: { 'pid': 15 },
	result: false
}, {
	pred: { ge: ['pid', 10] },		/* ge: <, =, > */
	values: { 'pid': 5 },
	result: false
}, {
	pred: { ge: ['pid', 10] },
	values: { 'pid': 10 },
	result: true
}, {
	pred: { ge: ['pid', 10] },
	values: { 'pid': 15 },
	result: true
}, {
	pred: { gt: ['pid', 10] },		/* gt: <, =, > */
	values: { 'pid': 5 },
	result: false
}, {
	pred: { gt: ['pid', 10] },
	values: { 'pid': 10 },
	result: false
}, {
	pred: { gt: ['pid', 10] },
	values: { 'pid': 15 },
	result: true
}, {
	pred: {
	    and: [
		{ eq: [ 'hostname', 'johnny tightlips' ] },
		{ eq: [ 'pid', 15 ] },
		{ eq: [ 'execname', 'sid the squealer' ] }
	    ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 15,
	    execname: 'sid the squealer'
	},
	result: true
}, {
	pred: {
	    and: [
		{ eq: [ 'hostname', 'johnny tightlips' ] },
		{ eq: [ 'pid', 15 ] },
		{ eq: [ 'execname', 'sid the squealer' ] }
	    ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 10,
	    execname: 'sid the squealer'
	},
	result: false
}, {
	pred: {
	    or: [
		{ eq: [ 'hostname', 'johnny tightlips' ] },
		{ eq: [ 'pid', 15 ] },
		{ eq: [ 'execname', 'sid the squealer' ] }
	    ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 10,
	    execname: 'sid the squealer'
	},
	result: true
}, {
	pred: {
	    or: [ {
		and: [
		    { eq: [ 'hostname', 'johnny tightlips' ] },
		    { eq: [ 'pid', 15 ] },
		    { eq: [ 'execname', 'sid the squealer' ] }
		]
	    }, {
		eq: [ 'trump', 'true' ]
	    } ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 10,
	    execname: 'sid the squealer',
	    trump: 'true'
	},
	result: true
}, {
	pred: {
	    or: [ {
		and: [
		    { eq: [ 'hostname', 'johnny tightlips' ] },
		    { eq: [ 'pid', 15 ] },
		    { eq: [ 'execname', 'sid the squealer' ] }
		]
	    }, {
		eq: [ 'trump', 'true' ]
	    } ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 10,
	    execname: 'sid the squealer',
	    trump: 'false'
	},
	result: false
} ];

var ii, result;
for (ii = 0; ii < test_cases.length; ii++) {
	mod_tl.ctStdout.info('test case %2d: checking %j with values %j',
	    ii + 1, test_cases[ii]['pred'], test_cases[ii]['values'],
	    test_cases[ii]['result']);
	mod_assert.equal(test_cases[ii]['result'], mod_capred.caPredEval(
	    test_cases[ii]['pred'], test_cases[ii]['values']));
}

/*
 * Test some invalid cases.
 */
function dump(err)
{
	if (err.message)
		mod_tl.ctStdout.info('error message: %s', err.message);
	else if (err)
		mod_tl.ctStdout.info('error: %j', err);
	return (true);
}

var fields = { 'numeric': 5, 'string': 'hello' };

mod_tl.ctStdout.info('testing invalid predicate form (array too small)');
mod_assert.throws(function () {
	mod_capred.caPredEval({ eq: [] }, fields);
}, dump);

mod_tl.ctStdout.info('testing invalid predicate form (wrong type)');
mod_assert.throws(function () {
	mod_capred.caPredEval({ eq: {} }, fields);
}, dump);

mod_tl.ctStdout.info('testing invalid predicate form (invalid key)');
mod_assert.throws(function () {
	mod_capred.caPredEval({ inval: [1, 2] }, fields);
}, dump);

mod_tl.ctStdout.info('testing invalid types');
mod_assert.throws(function () {
	mod_capred.caPredEval({ le: ['string', 3] }, fields);
}, dump);

mod_tl.ctStdout.info('testing missing value');
mod_assert.throws(function () {
	mod_capred.caPredEval({ le: ['junk', 3] }, fields);
}, dump);
