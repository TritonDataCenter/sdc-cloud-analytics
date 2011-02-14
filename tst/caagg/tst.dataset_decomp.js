/*
 * Tests caDatasetDecomp.
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_caagg = require('../../lib/ca/ca-agg');
var mod_tl = require('../../lib/tst/ca-test');

var dataset = mod_caagg.caDatasetForInstrumentation({
	'value-arity': mod_ca.ca_arity_discrete,
	'value-dimension': 2
    });

var source1 = 'source1';
var source2 = 'source2';
var source3 = 'source3';

var time1 = 12340;
var time2 = 12345;

/* initial state: all zeros */
mod_assert.deepEqual(dataset.dataForTime(time1), {});
mod_assert.deepEqual(dataset.dataForTime(time2), {});

/* single update */
dataset.update(source1, time1, {
	abe: 10,
	jasper: 20,
	molloy: 15
});
mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: 10,
	jasper: 20,
	molloy: 15
});
mod_assert.deepEqual(dataset.dataForTime(time2), {});

/* aggregating update */
dataset.update(source2, time1, {
	abe: 72,
	jasper: 57
});
mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: 82,
	jasper: 77,
	molloy: 15
});
mod_assert.deepEqual(dataset.dataForTime(time2), {});

/* another aggregating update */
dataset.update(source3, time1, {
	burns: 12,
	jasper: 5,
	molloy: 57
});
mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: 82,
	burns: 12,
	jasper: 82,
	molloy: 72
});
mod_assert.deepEqual(dataset.dataForTime(time2), {});

/* update time2 */
dataset.update(source1, time2, { burns: 57 });
mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: 82,
	burns: 12,
	jasper: 82,
	molloy: 72
});
mod_assert.deepEqual(dataset.dataForTime(time2), { burns: 57 });

/* don't expire old data */
dataset.expireBefore(time1);
mod_assert.deepEqual(dataset.dataForTime(time1), {
	abe: 82,
	burns: 12,
	jasper: 82,
	molloy: 72
});
mod_assert.deepEqual(dataset.dataForTime(time2), { burns: 57 });

/* expire old data */
dataset.expireBefore(time1 + 1);
mod_assert.deepEqual(dataset.dataForTime(time1), {});
mod_assert.deepEqual(dataset.dataForTime(time2), { burns: 57 });

/* undefined value */
dataset.update(source1, time1, undefined);
mod_assert.equal(dataset.nreporting(time1, 1), 1);
mod_assert.deepEqual(dataset.dataForTime(time1), {});
