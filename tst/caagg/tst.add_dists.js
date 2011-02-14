/*
 * Tests adding distributions using caAddDistributions.
 */

var mod_assert = require('assert');
var mod_caagg = require('../../lib/ca/ca-agg');
var mod_tl = require('../../lib/tst/ca-test');

var test_cases = [ {
	name: 'both sides empty',
	lhs: [],
	rhs: [],
	res: []
}, {
	name: 'empty side',
	lhs: [ [[10, 20], 30 ], [[80, 90], 57] ],
	rhs: [],
	res: [ [[10, 20], 30 ], [[80, 90], 57] ]
}, {
	name: 'superset high',
	lhs: [ [[10, 20], 25 ] ],
	rhs: [ [[10, 20], 30 ], [[80, 90], 57], [[110, 120], 10] ],
	res: [ [[10, 20], 55 ], [[80, 90], 57], [[110, 120], 10] ]
}, {
	name: 'superset mid',
	lhs: [ [[80, 90], 22 ] ],
	rhs: [ [[10, 20], 30 ], [[80, 90], 57], [[110, 120], 10] ],
	res: [ [[10, 20], 30 ], [[80, 90], 79], [[110, 120], 10] ]
}, {
	name: 'superset low',
	lhs: [ [[110, 120], 12 ] ],
	rhs: [ [[10, 20], 30 ], [[80, 90], 57], [[110, 120], 10] ],
	res: [ [[10, 20], 30 ], [[80, 90], 57], [[110, 120], 22] ]
}, {
	name: 'hole',
	lhs: [ [[30, 40], 7 ] ],
	rhs: [ [[10, 20], 30 ], [[80, 90], 57], [[110, 120], 10] ],
	res: [ [[10, 20], 30 ], [[30, 40],  7],
	    [[80, 90], 57], [[110, 120], 10] ]
}, {
	name: 'hole (2)',
	lhs: [ [[95, 105], 7 ] ],
	rhs: [ [[10, 20], 30 ], [[80, 90], 57], [[110, 120], 10] ],
	res: [ [[10, 20], 30 ], [[80, 90], 57],
	    [[95, 105], 7], [[110, 120], 10] ]
}, {
	name: 'mixed',
	lhs: [ [[10, 20], 8 ], [[20, 30], 5], [[50, 60], 17], [[90, 99], 3] ],
	rhs: [ [[0, 5], 2], [[5, 9], 7], [[10, 20], 17], [[40, 45], 15],
	    [[50, 60], 3], [[110, 120], 15], [[120, 130], 17] ],
	res: [ [[0, 5], 2], [[5, 9], 7], [[10, 20], 25], [[20, 30], 5],
	    [[40, 45], 15], [[50, 60], 20], [[90, 99], 3], [[110, 120], 15],
	    [[120, 130], 17] ]
} ];

function add(lhs, rhs)
{
	return (mod_caagg.caAddDistributions(caDeepCopy(lhs), caDeepCopy(rhs)));
}

var ii, test;

for (ii = 0; ii < test_cases.length; ii++) {
	test = test_cases[ii];

	mod_tl.ctStdout.info('test: lhs %s', test['name']);
	mod_assert.deepEqual(test['res'], add(test['lhs'], test['rhs']));

	mod_tl.ctStdout.info('test: rhs %s', test['name']);
	mod_assert.deepEqual(test['res'], add(test['rhs'], test['lhs']));
}
