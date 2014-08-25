/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests caRemoveCircularRefs.
 */

var mod_assert = require('assert');
var mod_sys = require('sys');
var ASSERT = mod_assert;

var mod_tl = require('../../lib/tst/ca-test');
var mod_ca = require('../../lib/ca/ca-common');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */

var examples, origdata, copy, ii;

/*
 * Basic types: caRemoveCircularRefs can't actually change these but we at least
 * make sure it doesn't throw an exception on them.
 */
examples = [ null, undefined, 0, 10, '', 'foo', false, true ];
for (ii = 0; ii < examples.length; ii++)
	caRemoveCircularRefs(examples[ii]);

/*
 * Slightly more complex non-basic types: make sure caRemoveCircularRefs doesn't
 * change them.
 */
examples = [ [], [ 1 ], [ 1, [ 2, 3 ] ], {}, { foo: 'bar' }, new Date(), {
	foo: 'bar',
	junk: 5,
	bob: true,
	somearr: [ 1, 2, { hello: 'world' }, 'dunk' ],
	stuff: {
		1: false,
		good: 'night',
		ppl: [ 'martin', 'prince' ],
		specials: {
			nully: null,
			undef: undefined
		}
	}
} ];

for (ii = 0; ii < examples.length; ii++) {
	origdata = examples[ii];
	copy = caDeepCopy(origdata);
	caRemoveCircularRefs(copy);
	ASSERT.deepEqual(origdata, copy);
}

/*
 * Complex circular input
 */
var data = [ {
	foo: 'bar',
	junk: 5,
	bob: true,
	somearr: [ 1, 2, { hello: 'world' }, 'dunk' ],
	stuff: {
		1: false,
		good: 'night',
		ppl: [ 'martin', 'prince' ],
		specials: {
			nully: null,
			undef: undefined
		}
	}
} ];

data[0]['data-itself'] = data[0];
data[0]['somearr'].push(data[0]['stuff']);
data[0]['stuff'][3] = data[0]['foo'];
data[0]['obj'] = { 'specials-again': data[0]['stuff']['specials'] };

console.log(mod_sys.inspect(data, false, null));
caRemoveCircularRefs(data);
console.log(mod_sys.inspect(data, false, null));

ASSERT.deepEqual(data, [ {
	foo: 'bar',
	junk: 5,
	bob: true,
	somearr: [ 1, 2, { hello: 'world' }, 'dunk', {
		1: false,
		3: 'bar',
		good: 'night',
		ppl: [ 'martin', 'prince' ],
		specials: {
			nully: null,
			undef: undefined
		}
	} ],
	stuff: {
		1: false,
		3: 'bar',
		good: 'night',
		ppl: [ 'martin', 'prince' ],
		specials: {
			nully: null,
			undef: undefined
		}
	},
	'data-itself': '<circular>',
	obj: {
	    'specials-again': {
		nully: null,
		undef: undefined
	    }
	}
} ]);

data[0]['stuff']['specials']['duck'] = data[0]['stuff'];
caRemoveCircularRefs(data);
console.log(mod_sys.inspect(data, false, null));

ASSERT.deepEqual(data, [ {
	foo: 'bar',
	junk: 5,
	bob: true,
	somearr: [ 1, 2, { hello: 'world' }, 'dunk', {
		1: false,
		3: 'bar',
		good: 'night',
		ppl: [ 'martin', 'prince' ],
		specials: {
			duck: '<circular>',
			nully: null,
			undef: undefined
		}
	} ],
	stuff: {
		1: false,
		3: 'bar',
		good: 'night',
		ppl: [ 'martin', 'prince' ],
		specials: {
			duck: '<circular>',
			nully: null,
			undef: undefined
		}
	},
	'data-itself': '<circular>',
	obj: {
	    'specials-again': {
		duck: '<circular>',
		nully: null,
		undef: undefined
	    }
	}
} ]);

JSON.stringify(data); /* should not throw exception */

data.push(data);
caRemoveCircularRefs(data);
ASSERT.deepEqual(data, [ {
	foo: 'bar',
	junk: 5,
	bob: true,
	somearr: [ 1, 2, { hello: 'world' }, 'dunk', {
		1: false,
		3: 'bar',
		good: 'night',
		ppl: [ 'martin', 'prince' ],
		specials: {
			duck: '<circular>',
			nully: null,
			undef: undefined
		}
	} ],
	stuff: {
		1: false,
		3: 'bar',
		good: 'night',
		ppl: [ 'martin', 'prince' ],
		specials: {
			duck: '<circular>',
			nully: null,
			undef: undefined
		}
	},
	'data-itself': '<circular>',
	obj: {
	    'specials-again': {
		duck: '<circular>',
		nully: null,
		undef: undefined
	    }
	}
}, '<circular>' ]);

console.log(mod_sys.inspect(data, false, null));
JSON.stringify(data); /* should not throw exception */
process.exit(0);
