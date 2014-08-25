/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests caAggrValueHeatmapDetails
 */

var mod_assert = require('assert');
var mod_agg = require('../../lib/ca/ca-agg');
var mod_atl = require('./aggtestlib');

var getval = mod_agg.caAggrHeatmapDetailsImpl.ai_value;
var xform = mod_atl.xform;
var request = { ca_params: {} };
var value1, value2;

/*
 * Simple numeric decomposition heatmaps.
 */
mod_atl.dataset_numeric.update('source', 12345, [[[10, 20], 5], [[30, 40], 3]]);
mod_atl.dataset_numeric.update('source', 12346, [[[0, 10], 7], [[10, 20], 2]]);
mod_atl.dataset_numeric.update('source', 12348, [[[10, 20], 100]]);

/* missing required params */
mod_assert.throws(function () {
	getval(mod_atl.dataset_both, 12345, 3, xform, request);
}, caValidationError);

request.ca_params['y'] = 10;
mod_assert.throws(function () {
	getval(mod_atl.dataset_both, 12345, 3, xform, request);
}, caValidationError);

request.ca_params['ymax'] = 300;
mod_assert.throws(function () {
	getval(mod_atl.dataset_both, 12345, 3, xform, request);
}, caValidationError);

request.ca_params['x'] = 5;
value1 = getval(mod_atl.dataset_both, 12345, 3, xform, request);

/* illegal params */
request.ca_params['ymin'] = 10;
request.ca_params['ymax'] = 100;
request.ca_params['width'] = 150;
request.ca_params['height'] = 180;
request.ca_params['nbuckets'] = 10;
request.ca_params['x'] = 150; /* too large */
mod_assert.throws(function () {
	getval(mod_atl.dataset_both, 12345, 3, xform, request);
}, caValidationError);

request.ca_params['x'] = 5;
request.ca_params['y'] = 180; /* too large */
mod_assert.throws(function () {
	getval(mod_atl.dataset_both, 12345, 3, xform, request);
}, caValidationError);

/* basic params */
request.ca_params['y'] = 10;
value1 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.equal(150, value1['width']);
mod_assert.equal(180, value1['height']);
mod_assert.equal(10, value1['nbuckets']);
mod_assert.ok('bucket_time' in value1);
mod_assert.ok(parseInt(value1['bucket_time'], 10) == value1['bucket_time']);
mod_assert.ok('bucket_ymin' in value1);
mod_assert.ok(parseInt(value1['bucket_ymin'], 10) == value1['bucket_ymin']);
mod_assert.ok('bucket_ymax' in value1);
mod_assert.ok(parseInt(value1['bucket_ymax'], 10) == value1['bucket_ymax']);
mod_assert.deepEqual(value1['present'], []);


/*
 * Two-dimensional decomposition heatmaps.
 */
mod_atl.dataset_both.update('source', 12345, {
    selma: [[[10, 20], 5], [[30, 40], 3]]
});

mod_atl.dataset_both.update('source', 12347, {
    selma: [[[0, 8], 7], [[10, 18], 2]],
    patty: [[[10, 18], 100]]
});

/* simulate click on bucket at 12347 near the bottom */
request.ca_params['ymin'] = 0;
request.ca_params['x'] = 125;
request.ca_params['y'] = 163;
value1 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.equal(value1['bucket_ymin'], 0);
mod_assert.equal(value1['bucket_ymax'], 10);
mod_assert.deepEqual(value1['present'], { 'selma': 7 });

/* now simulate a click on the bucket just above that one. */
request.ca_params['y'] = 161;
value1 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.equal(value1['bucket_ymin'], 10);
mod_assert.equal(value1['bucket_ymax'], 20);
mod_assert.deepEqual(value1['present'], { 'selma': 2, 'patty': 100 });
