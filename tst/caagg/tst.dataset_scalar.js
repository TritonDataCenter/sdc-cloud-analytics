/*
 * Tests caDatasetScalar.  This test also tests the common functions of
 * caDataset (including the source-related methods).
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_caagg = require('../../lib/ca/ca-agg');
var mod_tl = require('../../lib/tst/ca-test');

var spec = {
    'value-arity': mod_ca.ca_arity_scalar,
    'value-dimension': 1,
    'nsources': 2,
    'granularity': 1
};

var dataset = mod_caagg.caDatasetForInstrumentation(spec);
var stashed, restored;

var source1 = 'source1';
var source2 = 'source2';

var time1 = 12340;
var time2 = 12345;

/* initial state */
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 0);
mod_assert.equal(dataset.nreporting(time2, 1), 0);
mod_assert.equal(dataset.nreporting(time2 + 1, 1), 0);
mod_assert.equal(dataset.maxreporting(time1, 1), 0);
mod_assert.equal(dataset.maxreporting(time2, 1), 0);
mod_assert.equal(dataset.maxreporting(time2 + 1, 1), 0);
mod_assert.equal(dataset.dataForTime(time1), 0);
mod_assert.equal(dataset.dataForTime(time2), 0);
mod_assert.equal(dataset.dataForTime(time2 + 1), 0);

/* simple update */
dataset.update(source1, time1, 10);
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 1);
mod_assert.equal(dataset.nreporting(time1, 2), 0);
mod_assert.equal(dataset.nreporting(time2, 1), 0);
mod_assert.equal(dataset.maxreporting(time1, 1), 1);
mod_assert.equal(dataset.maxreporting(time1, 2), 1);
mod_assert.equal(dataset.maxreporting(time2, 1), 0);
mod_assert.equal(dataset.dataForTime(time1), 10);
mod_assert.equal(dataset.dataForTime(time2), 0);

/* aggregating update */
dataset.update(source2, time1, 15);
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 2);
mod_assert.equal(dataset.nreporting(time1, 2), 0);
mod_assert.equal(dataset.nreporting(time2, 1), 0);
mod_assert.equal(dataset.maxreporting(time1, 1), 2);
mod_assert.equal(dataset.maxreporting(time1, 2), 2);
mod_assert.equal(dataset.maxreporting(time2, 1), 0);
mod_assert.equal(dataset.dataForTime(time1), 25);
mod_assert.equal(dataset.dataForTime(time2), 0);

/* simple update, time2 */
dataset.update(source1, time2, 12);
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 2);
mod_assert.equal(dataset.nreporting(time2, 1), 1);
mod_assert.equal(dataset.nreporting(time2 + 1, 1), 0);
mod_assert.equal(dataset.maxreporting(time1, 1), 2);
mod_assert.equal(dataset.maxreporting(time1, 2), 2);
mod_assert.equal(dataset.maxreporting(time2, 1), 1);
mod_assert.equal(dataset.dataForTime(time1), 25);
mod_assert.equal(dataset.dataForTime(time2), 12);
mod_assert.equal(dataset.dataForTime(time2 + 1), 0);

/* simple update, time2 + 1 */
dataset.update(source2, time2 + 1, 15);
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 2);
mod_assert.equal(dataset.nreporting(time2, 1), 1);
mod_assert.equal(dataset.nreporting(time2, 2), 1);
mod_assert.equal(dataset.nreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.nreporting(time2 + 2, 1), 0);
mod_assert.equal(dataset.nreporting(time2 + 1, 2), 0);
mod_assert.equal(dataset.maxreporting(time1, 1), 2);
mod_assert.equal(dataset.maxreporting(time2, 1), 1);
mod_assert.equal(dataset.maxreporting(time2, 2), 1);
mod_assert.equal(dataset.maxreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.maxreporting(time2 + 2, 1), 0);
mod_assert.equal(dataset.maxreporting(time2 + 1, 2), 1);
mod_assert.equal(dataset.dataForTime(time1), 25);
mod_assert.equal(dataset.dataForTime(time2), 12);
mod_assert.equal(dataset.dataForTime(time2 + 1), 15);
mod_assert.equal(dataset.dataForTime(time2 + 2), 0);

/* aggregating update, time2 */
dataset.update(source2, time2, 15);
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 2);
mod_assert.equal(dataset.nreporting(time2, 1), 2);
mod_assert.equal(dataset.nreporting(time2, 2), 1);
mod_assert.equal(dataset.nreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.nreporting(time2 + 2, 1), 0);
mod_assert.equal(dataset.nreporting(time2 + 1, 2), 0);
mod_assert.equal(dataset.maxreporting(time1, 1), 2);
mod_assert.equal(dataset.maxreporting(time2, 1), 2);
mod_assert.equal(dataset.maxreporting(time2, 2), 2);
mod_assert.equal(dataset.maxreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.maxreporting(time2 + 2, 1), 0);
mod_assert.equal(dataset.maxreporting(time2 + 1, 2), 1);
mod_assert.equal(dataset.dataForTime(time1), 25);
mod_assert.equal(dataset.dataForTime(time2), 27);
mod_assert.equal(dataset.dataForTime(time2 + 1), 15);

/* stash / unstash */
stashed = dataset.stash();
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 2);
mod_assert.equal(dataset.nreporting(time2, 1), 2);
mod_assert.equal(dataset.nreporting(time2, 2), 1);
mod_assert.equal(dataset.nreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.nreporting(time2 + 2, 1), 0);
mod_assert.equal(dataset.nreporting(time2 + 1, 2), 0);
mod_assert.equal(dataset.maxreporting(time1, 1), 2);
mod_assert.equal(dataset.maxreporting(time2, 1), 2);
mod_assert.equal(dataset.maxreporting(time2, 2), 2);
mod_assert.equal(dataset.maxreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.maxreporting(time2 + 2, 1), 0);
mod_assert.equal(dataset.maxreporting(time2 + 1, 2), 1);
mod_assert.equal(dataset.dataForTime(time1), 25);
mod_assert.equal(dataset.dataForTime(time2), 27);
mod_assert.equal(dataset.dataForTime(time2 + 1), 15);

restored = mod_caagg.caDatasetForInstrumentation(spec);
mod_assert.equal(restored.maxreporting(time1, 2), 0);
restored.unstash(stashed['metadata'], stashed['data']);
mod_assert.equal(restored.nsources(), 2);
mod_assert.equal(restored.nreporting(time1, 1), 2);
mod_assert.equal(restored.nreporting(time2, 1), 2);
mod_assert.equal(restored.nreporting(time2, 2), 1);
mod_assert.equal(restored.nreporting(time2 + 1, 1), 1);
mod_assert.equal(restored.nreporting(time2 + 2, 1), 0);
mod_assert.equal(restored.nreporting(time2 + 1, 2), 0);
mod_assert.equal(restored.maxreporting(time1, 1), 2);
mod_assert.equal(restored.maxreporting(time2, 1), 2);
mod_assert.equal(restored.maxreporting(time2, 2), 2);
mod_assert.equal(restored.maxreporting(time2 + 1, 1), 1);
mod_assert.equal(restored.maxreporting(time2 + 2, 1), 0);
mod_assert.equal(restored.maxreporting(time2 + 1, 2), 1);
mod_assert.equal(restored.dataForTime(time1), 25);
mod_assert.equal(restored.dataForTime(time2), 27);
mod_assert.equal(restored.dataForTime(time2 + 1), 15);

/* expire old data */
dataset.expireBefore(time1 + 1);
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 0);
mod_assert.equal(dataset.nreporting(time2, 1), 2);
mod_assert.equal(dataset.nreporting(time2, 2), 1);
mod_assert.equal(dataset.nreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.nreporting(time2 + 2, 1), 0);
mod_assert.equal(dataset.nreporting(time2 + 1, 2), 0);
mod_assert.equal(dataset.maxreporting(time1, 1), 0);
mod_assert.equal(dataset.maxreporting(time2, 1), 2);
mod_assert.equal(dataset.maxreporting(time2, 2), 2);
mod_assert.equal(dataset.maxreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.maxreporting(time2 + 2, 1), 0);
mod_assert.equal(dataset.maxreporting(time2 + 1, 2), 1);
mod_assert.equal(dataset.dataForTime(time1), 0);
mod_assert.equal(dataset.dataForTime(time2), 27);
mod_assert.equal(dataset.dataForTime(time2 + 1), 15);

/* expire newer data */
dataset.expireBefore(time2 + 1);
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 0);
mod_assert.equal(dataset.nreporting(time2, 1), 0);
mod_assert.equal(dataset.nreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.maxreporting(time1, 1), 0);
mod_assert.equal(dataset.maxreporting(time2, 1), 0);
mod_assert.equal(dataset.maxreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.dataForTime(time1), 0);
mod_assert.equal(dataset.dataForTime(time2), 0);
mod_assert.equal(dataset.dataForTime(time2 + 1), 15);

/* stash / unstash again */
stashed = dataset.stash();
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 0);
mod_assert.equal(dataset.nreporting(time2, 1), 0);
mod_assert.equal(dataset.nreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.maxreporting(time1, 1), 0);
mod_assert.equal(dataset.maxreporting(time2, 1), 0);
mod_assert.equal(dataset.maxreporting(time2 + 1, 1), 1);
mod_assert.equal(dataset.dataForTime(time1), 0);
mod_assert.equal(dataset.dataForTime(time2), 0);
mod_assert.equal(dataset.dataForTime(time2 + 1), 15);

restored = mod_caagg.caDatasetForInstrumentation(spec);
mod_assert.equal(dataset.maxreporting(time1, 2), 0);
restored.unstash(stashed['metadata'], stashed['data']);
mod_assert.equal(restored.nsources(), 2);
mod_assert.equal(restored.nreporting(time1, 1), 0);
mod_assert.equal(restored.nreporting(time2, 1), 0);
mod_assert.equal(restored.nreporting(time2 + 1, 1), 1);
mod_assert.equal(restored.maxreporting(time1, 1), 0);
mod_assert.equal(restored.maxreporting(time2, 1), 0);
mod_assert.equal(restored.maxreporting(time2 + 1, 1), 1);
mod_assert.equal(restored.dataForTime(time1), 0);
mod_assert.equal(restored.dataForTime(time2), 0);
mod_assert.equal(restored.dataForTime(time2 + 1), 15);

/* expire all data */
dataset.expireBefore(time2 + 2);
mod_assert.equal(dataset.nsources(), 2);
mod_assert.equal(dataset.nreporting(time1, 1), 0);
mod_assert.equal(dataset.nreporting(time2, 1), 0);
mod_assert.equal(dataset.nreporting(time2 + 1, 1), 0);
mod_assert.equal(dataset.maxreporting(time1, 1), 0);
mod_assert.equal(dataset.maxreporting(time2, 1), 0);
mod_assert.equal(dataset.maxreporting(time2 + 1, 1), 0);
mod_assert.equal(dataset.dataForTime(time1), 0);
mod_assert.equal(dataset.dataForTime(time2), 0);
mod_assert.equal(dataset.dataForTime(time2 + 1), 0);

/* undefined value */
dataset.update(source1, time1, undefined);
mod_assert.equal(dataset.nreporting(time1, 1), 1);
mod_assert.equal(dataset.dataForTime(time1), 0);

/* test granularity > 1 */
dataset = mod_caagg.caDatasetForInstrumentation({
	'value-arity': mod_ca.ca_arity_scalar,
	'value-dimension': 1,
	'nsources': 2,
	'granularity': 10
});

/* initial state */
mod_assert.equal(0, dataset.dataForTime(123450));

/* data properly aligned */
dataset.update(source1, 123450, 5);
mod_assert.equal(0, dataset.dataForTime(123440));
mod_assert.equal(5, dataset.dataForTime(123450));
mod_assert.equal(0, dataset.dataForTime(123460));

/* data not aligned */
dataset.update(source1, 123449, 4);
mod_assert.equal(4, dataset.dataForTime(123440));
mod_assert.equal(5, dataset.dataForTime(123450));
mod_assert.equal(0, dataset.dataForTime(123460));

dataset.update(source1, 123451, 3);
mod_assert.equal(4, dataset.dataForTime(123440));
mod_assert.equal(8, dataset.dataForTime(123450));
mod_assert.equal(0, dataset.dataForTime(123460));

dataset.update(source1, 123459, 2);
mod_assert.equal(4, dataset.dataForTime(123440));
mod_assert.equal(10, dataset.dataForTime(123450));
mod_assert.equal(0, dataset.dataForTime(123460));

dataset.update(source1, 123460, 1);
mod_assert.equal(4, dataset.dataForTime(123440));
mod_assert.equal(10, dataset.dataForTime(123450));
mod_assert.equal(1, dataset.dataForTime(123460));
