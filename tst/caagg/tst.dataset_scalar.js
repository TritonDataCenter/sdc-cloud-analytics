/*
 * Tests caDatasetScalar.  This test also tests the common functions of
 * caDataset (including the source-related methods).
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_caagg = require('../../lib/ca/ca-agg');
var mod_tl = require('../../lib/tst/ca-test');

var dataset = mod_caagg.caDatasetForInstrumentation({
	'value-arity': mod_ca.ca_arity_scalar,
	'value-dimension': 1
    });

var source1 = 'source1';
var source2 = 'source2';

var time1 = 12340;
var time2 = 12345;

/* initial state */
mod_assert.equal(dataset.nsources(), 0);
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
mod_assert.equal(dataset.nsources(), 1);
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
