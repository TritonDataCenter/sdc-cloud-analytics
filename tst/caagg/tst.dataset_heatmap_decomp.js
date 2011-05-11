/*
 * Tests caDatasetHeatmapDecomp
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_caagg = require('../../lib/ca/ca-agg');
var mod_tl = require('../../lib/tst/ca-test');

var spec = {
    'value-arity': mod_ca.ca_arity_numeric,
    'value-dimension': 3,
    'granularity': 1
};

var dataset = mod_caagg.caDatasetForInstrumentation(spec);
var stashed, restored;

var source1 = 'source1';
var source2 = 'source2';
var source3 = 'source3';

var time1 = 12340;
var time2 = 12345;
var abe, glick, jasper, molloy, total;


/* initial state: all zeros */
mod_assert.deepEqual(dataset.dataForTime(time1), {});
mod_assert.deepEqual(dataset.dataForTime(time2), {});
mod_assert.deepEqual(dataset.dataForKey('abe'), {});
mod_assert.deepEqual(dataset.keysForTime(time1, 1), []);
mod_assert.deepEqual(dataset.total(), {});


/* single update */
dataset.update(source1, time1, {
	abe: [
	    [[10, 20], 10],
	    [[40, 50], 27]
	],
	jasper: [
	    [[20, 30], 15],
	    [[40, 50], 17]
	]
});
mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: [
	    [[10, 20], 10],
	    [[40, 50], 27]
	],
	jasper: [
	    [[20, 30], 15],
	    [[40, 50], 17]
	]
});
mod_assert.deepEqual(dataset.keysForTime(time1, 1).sort(), [ 'abe', 'jasper' ]);
mod_assert.deepEqual(dataset.dataForTime(time2), {});
mod_assert.deepEqual(dataset.keysForTime(time2, 1), []);

abe = {};
abe[time1] = [
    [[10, 20], 10],
    [[40, 50], 27]
];
mod_assert.deepEqual(dataset.dataForKey('abe'), abe);

jasper = {};
jasper[time1] = [
    [[20, 30], 15],
    [[40, 50], 17]
];
mod_assert.deepEqual(dataset.dataForKey('jasper'), jasper);

total = {};
total[time1] = [
    [[10, 20], 10],
    [[20, 30], 15],
    [[40, 50], 44]
];
mod_assert.deepEqual(dataset.total(), total);


/* aggregating update */
dataset.update(source2, time1, {
    abe: [
	[[40, 50], 17],
	[[60, 70], 15]
    ],
    molloy:[
	[[ 0, 10], 13],
	[[10, 20], 15],
	[[30, 40],  7],
	[[40, 50],  3]
    ]
});

mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: [
	    [[10, 20], 10],
	    [[40, 50], 44],
	    [[60, 70], 15]
	],
	jasper: [
	    [[20, 30], 15],
	    [[40, 50], 17]
	],
 	molloy: [
	    [[ 0, 10], 13],
	    [[10, 20], 15],
	    [[30, 40],  7],
	    [[40, 50],  3]
	]
});
mod_assert.deepEqual(dataset.keysForTime(time1, 1).sort(),
    [ 'abe', 'jasper', 'molloy' ]);
mod_assert.deepEqual(dataset.dataForTime(time2), {});
mod_assert.deepEqual(dataset.keysForTime(time2, 1), []);

abe[time1] = [
    [[10, 20], 10],
    [[40, 50], 44],
    [[60, 70], 15]
];
mod_assert.deepEqual(dataset.dataForKey('abe'), abe);
mod_assert.deepEqual(dataset.dataForKey('jasper'), jasper);

molloy = {};
molloy[time1] = [
    [[ 0, 10], 13],
    [[10, 20], 15],
    [[30, 40],  7],
    [[40, 50],  3]
];
mod_assert.deepEqual(dataset.dataForKey('molloy'), molloy);

total = {};
total[time1] = [
    [[ 0, 10], 13],
    [[10, 20], 25],
    [[20, 30], 15],
    [[30, 40],  7],
    [[40, 50], 64],
    [[60, 70], 15]
];
mod_assert.deepEqual(dataset.total(), total);


/* another aggregating update */
dataset.update(source3, time1, {
    abe:	[ [[20, 30],  9] ],
    molloy:	[ [[ 0, 10],  5] ]
});

mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: [
	    [[10, 20], 10],
	    [[20, 30],  9],
	    [[40, 50], 44],
	    [[60, 70], 15]
	],
	jasper: [
	    [[20, 30], 15],
	    [[40, 50], 17]
	],
 	molloy: [
	    [[ 0, 10], 18],
	    [[10, 20], 15],
	    [[30, 40],  7],
	    [[40, 50],  3]
	]
});
mod_assert.deepEqual(dataset.keysForTime(time1, 1).sort(),
    [ 'abe', 'jasper', 'molloy' ]);
mod_assert.deepEqual(dataset.dataForTime(time2), {});
mod_assert.deepEqual(dataset.keysForTime(time2, 1), []);

abe[time1] = [
    [[10, 20], 10],
    [[20, 30],  9],
    [[40, 50], 44],
    [[60, 70], 15]
];
mod_assert.deepEqual(dataset.dataForKey('abe'), abe);
mod_assert.deepEqual(dataset.dataForKey('jasper'), jasper);

molloy = {};
molloy[time1] = [
    [[ 0, 10], 18],
    [[10, 20], 15],
    [[30, 40],  7],
    [[40, 50],  3]
];
mod_assert.deepEqual(dataset.dataForKey('molloy'), molloy);

total = {};
total[time1] = [
    [[ 0, 10], 18],
    [[10, 20], 25],
    [[20, 30], 24],
    [[30, 40],  7],
    [[40, 50], 64],
    [[60, 70], 15]
];
mod_assert.deepEqual(dataset.total(), total);


/* update time2 */
dataset.update(source1, time2, {
	abe: [ [[0, 10], 12] ],
	glick: [ [[10, 20], 15] ]
});
mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: [
	    [[10, 20], 10],
	    [[20, 30],  9],
	    [[40, 50], 44],
	    [[60, 70], 15]
	],
	jasper: [
	    [[20, 30], 15],
	    [[40, 50], 17]
	],
 	molloy: [
	    [[ 0, 10], 18],
	    [[10, 20], 15],
	    [[30, 40],  7],
	    [[40, 50],  3]
	]
});
mod_assert.deepEqual(dataset.keysForTime(time1, 1).sort(),
    [ 'abe', 'jasper', 'molloy' ]);
mod_assert.deepEqual(dataset.keysForTime(time1, time2 + 1 - time1).sort(),
    [ 'abe', 'glick', 'jasper', 'molloy' ]);
mod_assert.deepEqual(dataset.dataForTime(time2), {
    abe: [[[0, 10], 12]],
    glick: [[[10, 20], 15]]
});
mod_assert.deepEqual(dataset.keysForTime(time2, 1).sort(), [ 'abe', 'glick' ]);

abe[time2] = [ [[0, 10], 12 ] ];
mod_assert.deepEqual(dataset.dataForKey('abe'), abe);
glick = {};
glick[time2] = [ [[10, 20], 15 ] ];
mod_assert.deepEqual(dataset.dataForKey('glick'), glick);
mod_assert.deepEqual(dataset.dataForKey('jasper'), jasper);
mod_assert.deepEqual(dataset.dataForKey('molloy'), molloy);

total[time2] = [
    [[ 0, 10], 12],
    [[10, 20], 15]
];
mod_assert.deepEqual(dataset.total(), total);

/* stash / unstash */
stashed = dataset.stash();
restored = mod_caagg.caDatasetForInstrumentation(spec);
mod_assert.deepEqual(restored.total(), {});
mod_assert.deepEqual(restored.keysForTime(time1, 1), []);
mod_assert.deepEqual(restored.dataForTime(time1), {});
mod_assert.deepEqual(restored.dataForKey('abe'), {});
restored.unstash(stashed['metadata'], stashed['data']);

mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: [
	    [[10, 20], 10],
	    [[20, 30],  9],
	    [[40, 50], 44],
	    [[60, 70], 15]
	],
	jasper: [
	    [[20, 30], 15],
	    [[40, 50], 17]
	],
 	molloy: [
	    [[ 0, 10], 18],
	    [[10, 20], 15],
	    [[30, 40],  7],
	    [[40, 50],  3]
	]
});
mod_assert.deepEqual(dataset.keysForTime(time1, 1).sort(),
    [ 'abe', 'jasper', 'molloy' ]);
mod_assert.deepEqual(dataset.keysForTime(time1, time2 + 1 - time1).sort(),
    [ 'abe', 'glick', 'jasper', 'molloy' ]);
mod_assert.deepEqual(dataset.dataForTime(time2), {
    abe: [[[0, 10], 12]],
    glick: [[[10, 20], 15]]
});
mod_assert.deepEqual(dataset.keysForTime(time2, 1).sort(), [ 'abe', 'glick' ]);
mod_assert.deepEqual(dataset.dataForKey('abe'), abe);
mod_assert.deepEqual(dataset.dataForKey('glick'), glick);
mod_assert.deepEqual(dataset.dataForKey('jasper'), jasper);
mod_assert.deepEqual(dataset.dataForKey('molloy'), molloy);
mod_assert.deepEqual(dataset.total(), total);

mod_assert.deepEqual(restored.dataForTime(time1), {
	abe: [
	    [[10, 20], 10],
	    [[20, 30],  9],
	    [[40, 50], 44],
	    [[60, 70], 15]
	],
	jasper: [
	    [[20, 30], 15],
	    [[40, 50], 17]
	],
 	molloy: [
	    [[ 0, 10], 18],
	    [[10, 20], 15],
	    [[30, 40],  7],
	    [[40, 50],  3]
	]
});
mod_assert.deepEqual(restored.keysForTime(time1, 1).sort(),
    [ 'abe', 'jasper', 'molloy' ]);
mod_assert.deepEqual(restored.keysForTime(time1, time2 + 1 - time1).sort(),
    [ 'abe', 'glick', 'jasper', 'molloy' ]);
mod_assert.deepEqual(restored.dataForTime(time2), {
    abe: [[[0, 10], 12]],
    glick: [[[10, 20], 15]]
});
mod_assert.deepEqual(restored.keysForTime(time2, 1).sort(), [ 'abe', 'glick' ]);
mod_assert.deepEqual(restored.dataForKey('abe'), abe);
mod_assert.deepEqual(restored.dataForKey('glick'), glick);
mod_assert.deepEqual(restored.dataForKey('jasper'), jasper);
mod_assert.deepEqual(restored.dataForKey('molloy'), molloy);
mod_assert.deepEqual(restored.total(), total);


/* don't expire old data */
dataset.expireBefore(time1);
mod_assert.deepEqual(dataset.keysForTime(time1, 1).sort(),
    [ 'abe', 'jasper', 'molloy' ]);
mod_assert.deepEqual(dataset.keysForTime(time1, time2 + 1 - time1).sort(),
    [ 'abe', 'glick', 'jasper', 'molloy' ]);
mod_assert.deepEqual(dataset.dataForTime(time2), {
	abe: [[[0, 10], 12]],
	glick: [[[10, 20], 15]]
});
mod_assert.deepEqual(dataset.keysForTime(time2, 1), [ 'abe', 'glick' ]);
mod_assert.deepEqual(dataset.dataForKey('abe'), abe);
mod_assert.deepEqual(dataset.dataForKey('glick'), glick);
mod_assert.deepEqual(dataset.dataForKey('jasper'), jasper);
mod_assert.deepEqual(dataset.dataForKey('molloy'), molloy);
mod_assert.deepEqual(dataset.total(), total);


/* expire old data */
dataset.expireBefore(time1 + 1);
mod_assert.deepEqual(dataset.dataForTime(time1), {});
mod_assert.deepEqual(dataset.keysForTime(time1, 1), []);
mod_assert.deepEqual(dataset.keysForTime(time1, time2 + 1 - time1).sort(),
    [ 'abe', 'glick' ]);
mod_assert.deepEqual(dataset.dataForTime(time2), {
	abe: [[[0, 10], 12]],
	glick: [[[10, 20], 15]]
});
mod_assert.deepEqual(dataset.keysForTime(time2, 1), [ 'abe', 'glick' ]);

delete (abe[time1]);
mod_assert.deepEqual(dataset.dataForKey('abe'), abe);
mod_assert.deepEqual(dataset.dataForKey('glick'), glick);
mod_assert.deepEqual(dataset.dataForKey('jasper'), {});
mod_assert.deepEqual(dataset.dataForKey('molloy'), {});

delete (total[time1]);
mod_assert.deepEqual(dataset.total(), total);


/* undefined value */
dataset.update(source1, time1, undefined);
mod_assert.equal(dataset.nreporting(time1, 1), 1);
mod_assert.deepEqual(dataset.dataForTime(time1), {});


/* granularity > 0 */
dataset = mod_caagg.caDatasetForInstrumentation({
    'value-arity': mod_ca.ca_arity_numeric,
    'value-dimension': 3,
    'granularity': 10
});

/* initial state */
mod_assert.deepEqual({}, dataset.dataForTime(123450));

/* data properly aligned */
dataset.update(source1, 123450, { abe: [[[10, 20], 5 ]] });
mod_assert.deepEqual({}, dataset.dataForTime(123440));
mod_assert.deepEqual({ abe: [[[10, 20], 5 ]] }, dataset.dataForTime(123450));
mod_assert.deepEqual({}, dataset.dataForTime(123460));

/* data not aligned */
dataset.update(source1, 123449, { abe: [[[10, 20], 4 ]] });
mod_assert.deepEqual({ abe: [[[10, 20], 4 ]] }, dataset.dataForTime(123440));
mod_assert.deepEqual({ abe: [[[10, 20], 5 ]] }, dataset.dataForTime(123450));
mod_assert.deepEqual({}, dataset.dataForTime(123460));

dataset.update(source1, 123451, { abe: [[[10, 20], 3 ]] });
mod_assert.deepEqual({ abe: [[[10, 20], 4 ]] }, dataset.dataForTime(123440));
mod_assert.deepEqual({ abe: [[[10, 20], 8 ]] }, dataset.dataForTime(123450));
mod_assert.deepEqual({}, dataset.dataForTime(123460));

dataset.update(source1, 123459, { abe: [[[10, 20], 2 ]] });
mod_assert.deepEqual({ abe: [[[10, 20], 4 ]] }, dataset.dataForTime(123440));
mod_assert.deepEqual({ abe: [[[10, 20], 10 ]] }, dataset.dataForTime(123450));
mod_assert.deepEqual({}, dataset.dataForTime(123460));

dataset.update(source1, 123460, { abe: [[[10, 20], 1 ]] });
mod_assert.deepEqual({ abe: [[[10, 20], 4 ]] }, dataset.dataForTime(123440));
mod_assert.deepEqual({ abe: [[[10, 20], 10 ]] }, dataset.dataForTime(123450));
mod_assert.deepEqual({ abe: [[[10, 20], 1 ]] }, dataset.dataForTime(123460));
