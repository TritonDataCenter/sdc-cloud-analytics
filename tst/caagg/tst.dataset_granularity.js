/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests granularities other than 1.  Note that some of this is tested in the
 * corresponding dataset's implementation.
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_caagg = require('../../lib/ca/ca-agg');
var mod_tl = require('../../lib/tst/ca-test');

var source1 = 'source1';
var source2 = 'source2';
var source3 = 'source3';
var dataset, ii;

dataset = mod_caagg.caDatasetForInstrumentation({
	'value-arity': mod_ca.ca_arity_scalar,
	'value-dimension': 1,
	'value-scope': 'interval',
	'nsources': 2,
	'granularity': 10
});

/* normalizeInterval() functionality */
mod_assert.deepEqual(dataset.normalizeInterval(12340, 10), {
	start_time: 12340,
	duration: 10
});

mod_assert.deepEqual(dataset.normalizeInterval(12339, 10), {
	start_time: 12330,
	duration: 10
});

mod_assert.deepEqual(dataset.normalizeInterval(12345, 1), {
	start_time: 12340,
	duration: 10
});

mod_assert.deepEqual(dataset.normalizeInterval(12345, 12), {
	start_time: 12340,
	duration: 20
});

/* tracking number of sources reporting */
mod_assert.equal(dataset.nreporting(12330), 0);
mod_assert.equal(dataset.nreporting(12340), 0);
mod_assert.equal(dataset.nreporting(12350), 0);

dataset.update('source1', 12340, 5);
mod_assert.equal(dataset.nreporting(12330), 0);
mod_assert.equal(dataset.nreporting(12340), 1);
mod_assert.equal(dataset.nreporting(12350), 0);

dataset.update('source1', 12344, 5);
mod_assert.equal(dataset.nreporting(12340), 1);
mod_assert.equal(dataset.nreporting(12350), 0);

dataset.update('source1', 12348, 5);
mod_assert.equal(dataset.nreporting(12340), 1);
mod_assert.equal(dataset.nreporting(12350), 0);

dataset.update('source2', 12348, 5);
mod_assert.equal(dataset.nreporting(12340), 2);
mod_assert.equal(dataset.nreporting(12350), 0);

dataset.update('source2', 12351, 5);
mod_assert.equal(dataset.nreporting(12340), 2);
mod_assert.equal(dataset.nreporting(12350), 1);
mod_assert.equal(dataset.nreporting(12360), 0);

mod_assert.equal(dataset.nreporting(12340, 20), 1);
mod_assert.equal(dataset.nreporting(12340, 10), 2);
mod_assert.equal(dataset.nreporting(12350, 10), 1);
mod_assert.equal(dataset.maxreporting(12340, 20), 2);
mod_assert.equal(dataset.maxreporting(12340, 10), 2);
mod_assert.equal(dataset.maxreporting(12350, 10), 1);

dataset.expireBefore(12350);
mod_assert.equal(dataset.nreporting(12340, 20), 0);
mod_assert.equal(dataset.nreporting(12340, 10), 0);
mod_assert.equal(dataset.nreporting(12350, 10), 1);
mod_assert.equal(dataset.maxreporting(12340, 20), 1);
mod_assert.equal(dataset.maxreporting(12340, 10), 0);
mod_assert.equal(dataset.maxreporting(12350, 10), 1);
