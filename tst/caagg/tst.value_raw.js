/*
 * Tests caAggrValueRaw
 */

var mod_assert = require('assert');
var mod_agg = require('../../lib/ca/ca-agg');
var mod_atl = require('./aggtestlib');

var getval = mod_agg.caAggrRawImpl.ai_value;
var xform = mod_atl.xform;
var value1, value2;

/*
 * Scalar raw values.
 */
mod_atl.dataset_scalar.update('source', 12345, 10);
mod_atl.dataset_scalar.update('source', 12346, 15);
mod_atl.dataset_scalar.update('source', 12348, 7);

mod_assert.deepEqual(getval(mod_atl.dataset_scalar, 12345, 1, xform), {
    value: 10,
    transformations: { len: {} }
});

mod_assert.deepEqual(getval(mod_atl.dataset_scalar, 12346, 2, xform), {
    value: 15,
    transformations: { len: {} }
});

mod_assert.deepEqual(getval(mod_atl.dataset_scalar, 12346, 3, xform), {
    value: 22,
    transformations: { len: {} }
});

/*
 * Simple discrete decomposition raw values.
 */
mod_atl.dataset_discrete.update('source', 12345, { selma: 10 });
mod_atl.dataset_discrete.update('source', 12347, { selma: 3, patty: 15 });

mod_assert.deepEqual(getval(mod_atl.dataset_discrete, 12345, 1, xform), {
    value: { selma: 10 },
    transformations: { len: { selma: 5 } }
});

mod_assert.deepEqual(getval(mod_atl.dataset_discrete, 12345, 3, xform), {
    value: { selma: 13, patty: 15 },
    transformations: { len: { selma: 5, patty: 5 } }
});

/*
 * Simple numeric decomposition raw values.
 */
mod_atl.dataset_numeric.update('source', 12345, [[[10, 20], 5], [[30, 40], 3]]);
mod_atl.dataset_numeric.update('source', 12346, [[[0, 10], 7], [[10, 20], 2]]);
mod_atl.dataset_numeric.update('source', 12348, [[[10, 20], 100]]);

mod_assert.deepEqual(getval(mod_atl.dataset_numeric, 12345, 1, xform), {
    value: [[[10, 20], 5], [[30, 40], 3]],
    transformations: { len: {} }
});

mod_assert.deepEqual(getval(mod_atl.dataset_numeric, 12346, 3, xform), {
    value: [[[0, 10], 7], [[10, 20], 102]],
    transformations: { len: {} }
});

/*
 * Two-dimensional decomposition.
 */
mod_atl.dataset_both.update('source', 12345, {
    selma: [[[10, 20], 5], [[30, 40], 3]]
});

mod_atl.dataset_both.update('source', 12347, {
    selma: [[[0, 10], 7], [[10, 20], 2]],
    patty: [[[10, 20], 100]]
});

mod_assert.deepEqual(getval(mod_atl.dataset_both, 12345, 1, xform), {
    value: {
	selma: [[[10, 20], 5], [[30, 40], 3]]
    },
    transformations: { len: { selma: 5 } }
});

mod_assert.deepEqual(getval(mod_atl.dataset_both, 12345, 10, xform), {
    value: {
	selma: [[[0, 10], 7], [[10, 20], 7], [[30, 40], 3]],
	patty: [[[10, 20], 100 ]]
    },
    transformations: { len: { selma: 5, patty: 5 } }
});
