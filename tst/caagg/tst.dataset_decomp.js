/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests caDatasetDecomp.
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_caagg = require('../../lib/ca/ca-agg');
var mod_tl = require('../../lib/tst/ca-test');

var spec = {
    'value-arity': mod_ca.ca_arity_discrete,
    'value-dimension': 2,
    'value-scope': 'interval',
    'granularity': 1
};

var dataset = mod_caagg.caDatasetForInstrumentation(spec);
var stashed, restored;

var source1 = 'source1';
var source2 = 'source2';
var source3 = 'source3';

var time1 = 12340;
var time2 = 12345;

/* initial state: all zeros */
mod_assert.deepEqual(dataset.dataForTime(time1, 1), {});
mod_assert.deepEqual(dataset.dataForTime(time2, 1), {});

/* single update */
dataset.update(source1, time1, {
	abe: 10,
	jasper: 20,
	molloy: 15
});
mod_assert.deepEqual(dataset.dataForTime(time1, 1), {
	abe: 10,
	jasper: 20,
	molloy: 15
});
mod_assert.deepEqual(dataset.dataForTime(time2, 1), {});

/* aggregating update */
dataset.update(source2, time1, {
	abe: 72,
	jasper: 57
});
mod_assert.deepEqual(dataset.dataForTime(time1, 1), {
	abe: 82,
	jasper: 77,
	molloy: 15
});
mod_assert.deepEqual(dataset.dataForTime(time2, 1), {});

/* another aggregating update */
dataset.update(source3, time1, {
	burns: 12,
	jasper: 5,
	molloy: 57
});
mod_assert.deepEqual(dataset.dataForTime(time1, 1), {
	abe: 82,
	burns: 12,
	jasper: 82,
	molloy: 72
});
mod_assert.deepEqual(dataset.dataForTime(time2, 1), {});

/* update time2 */
dataset.update(source1, time2, { burns: 57 });
mod_assert.deepEqual(dataset.dataForTime(time1, 1), {
	abe: 82,
	burns: 12,
	jasper: 82,
	molloy: 72
});
mod_assert.deepEqual(dataset.dataForTime(time2, 1), { burns: 57 });

/* add over multiple intervals */
mod_assert.deepEqual(dataset.dataForTime(time1, time2 - time1 + 1), {
	abe: 82,
	burns: 69,
	jasper: 82,
	molloy: 72
});

/* don't expire old data */
dataset.expireBefore(time1);
mod_assert.deepEqual(dataset.dataForTime(time1, 1), {
	abe: 82,
	burns: 12,
	jasper: 82,
	molloy: 72
});
mod_assert.deepEqual(dataset.dataForTime(time2, 1), { burns: 57 });

/* stash / unstash */
stashed = dataset.stash();
restored = mod_caagg.caDatasetForInstrumentation(spec);
mod_assert.deepEqual(restored.dataForTime(time1, 1), {});
mod_assert.deepEqual(restored.dataForTime(time2, 1), {});
restored.unstash(stashed['metadata'], stashed['data']);
mod_assert.deepEqual(dataset.dataForTime(time1, 1), {
	abe: 82,
	burns: 12,
	jasper: 82,
	molloy: 72
});
mod_assert.deepEqual(restored.dataForTime(time1, 1), {
	abe: 82,
	burns: 12,
	jasper: 82,
	molloy: 72
});
mod_assert.deepEqual(dataset.dataForTime(time2, 1), { burns: 57 });
mod_assert.deepEqual(restored.dataForTime(time2, 1), { burns: 57 });

/* expire old data */
dataset.expireBefore(time1 + 1);
mod_assert.deepEqual(dataset.dataForTime(time1, 1), {});
mod_assert.deepEqual(dataset.dataForTime(time2, 1), { burns: 57 });

/* undefined value */
dataset.update(source1, time1, undefined);
mod_assert.equal(dataset.nreporting(time1, 1), 1);
mod_assert.deepEqual(dataset.dataForTime(time1, 1), {});

/* granularity > 0 */
dataset = mod_caagg.caDatasetForInstrumentation({
    'value-arity': mod_ca.ca_arity_discrete,
    'value-dimension': 2,
    'granularity': 10
});

/* initial state */
mod_assert.deepEqual({}, dataset.dataForTime(123450, 10));

/* data properly aligned */
dataset.update(source1, 123450, { abe: 5 });
mod_assert.deepEqual({}, dataset.dataForTime(123440, 10));
mod_assert.deepEqual({ abe: 5 }, dataset.dataForTime(123450, 10));
mod_assert.deepEqual({}, dataset.dataForTime(123460, 10));

/* data not aligned */
dataset.update(source1, 123449, { abe: 4 });
mod_assert.deepEqual({ abe: 4 }, dataset.dataForTime(123440, 10));
mod_assert.deepEqual({ abe: 5 }, dataset.dataForTime(123450, 10));
mod_assert.deepEqual({}, dataset.dataForTime(123460, 10));

dataset.update(source1, 123451, { abe: 3 });
mod_assert.deepEqual({ abe: 4 }, dataset.dataForTime(123440, 10));
mod_assert.deepEqual({ abe: 8 }, dataset.dataForTime(123450, 10));
mod_assert.deepEqual({}, dataset.dataForTime(123460, 10));

dataset.update(source1, 123459, { abe: 2 });
mod_assert.deepEqual({ abe: 4 }, dataset.dataForTime(123440, 10));
mod_assert.deepEqual({ abe: 10 }, dataset.dataForTime(123450, 10));
mod_assert.deepEqual({}, dataset.dataForTime(123460, 10));

dataset.update(source1, 123460, { abe: 1 });
mod_assert.deepEqual({ abe: 4 }, dataset.dataForTime(123440, 10));
mod_assert.deepEqual({ abe: 10 }, dataset.dataForTime(123450, 10));
mod_assert.deepEqual({ abe: 1 }, dataset.dataForTime(123460, 10));
