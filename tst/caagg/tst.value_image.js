/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests caAggrValueHeatmapImage
 */

var mod_assert = require('assert');
var mod_agg = require('../../lib/ca/ca-agg');
var mod_atl = require('./aggtestlib');

var getval = mod_agg.caAggrHeatmapImageImpl.ai_value;
var xform = mod_atl.xform;
var request = { ca_params: {} };
var value1, value2;

/*
 * Simple numeric decomposition heatmaps.
 */
mod_atl.dataset_numeric.update('source', 12345, [[[10, 20], 5], [[30, 40], 3]]);
mod_atl.dataset_numeric.update('source', 12346, [[[0, 10], 7], [[10, 20], 2]]);
mod_atl.dataset_numeric.update('source', 12348, [[[10, 20], 100]]);

/* default params */
value1 = getval(mod_atl.dataset_numeric, 12345, 1, xform, request);
mod_assert.ok('ymin' in value1 &&
    parseInt(value1['ymin'], 10) == value1['ymin']);
mod_assert.ok('ymax' in value1 &&
    parseInt(value1['ymax'], 10) == value1['ymax']);
mod_assert.ok('width' in value1 &&
    parseInt(value1['width'], 10) == value1['width']);
mod_assert.ok('height' in value1 &&
    parseInt(value1['height'], 10) == value1['height']);
mod_assert.ok('nbuckets' in value1 &&
    parseInt(value1['nbuckets'], 10) == value1['nbuckets']);
mod_assert.deepEqual(value1['present'], []);
mod_assert.deepEqual(value1['transformations'], { len: {} });
mod_assert.ok('image' in value1);
mod_assert.ok(typeof (value1['image']) == 'string');
mod_assert.ok(value1['image'].length > 10);

/* aggregating multiple data points (only the image should be different) */
value2 = getval(mod_atl.dataset_numeric, 12345, 3, xform, request);
mod_assert.notEqual(value1['image'], value2['image']);
delete (value1['image']);
delete (value2['image']);
mod_assert.deepEqual(value1, value2);

/* user-specified params */
request.ca_params['ymin'] = 10;
request.ca_params['ymax'] = 20;
request.ca_params['width'] = 200;
request.ca_params['height'] = 150;
request.ca_params['nbuckets'] = 10;
value1 = getval(mod_atl.dataset_numeric, 12345, 3, xform, request);
mod_assert.equal(10, value1['ymin']);
mod_assert.equal(20, value1['ymax']);
mod_assert.equal(200, value1['width']);
mod_assert.equal(150, value1['height']);
mod_assert.equal(10, value1['nbuckets']);
mod_assert.notEqual(value1['image'], value2['image']);

request.ca_params['hues'] = [ 0 ];
value2 = getval(mod_atl.dataset_numeric, 12345, 3, xform, request);
mod_assert.notEqual(value1['image'], value2['image']);

/*
 * Two-dimensional decomposition heatmaps.
 */
mod_atl.dataset_both.update('source', 12345, {
    selma: [[[10, 20], 5], [[30, 40], 3]]
});

mod_atl.dataset_both.update('source', 12347, {
    selma: [[[0, 10], 7], [[10, 20], 2]],
    patty: [[[10, 20], 100]]
});

value1 = getval(mod_atl.dataset_both, 12345, 1, xform, request);
mod_assert.equal(10, value1['ymin']);
mod_assert.equal(20, value1['ymax']);
mod_assert.equal(200, value1['width']);
mod_assert.equal(150, value1['height']);
mod_assert.equal(10, value1['nbuckets']);
mod_assert.ok('image' in value1);
mod_assert.ok(typeof (value1['image']) == 'string');
mod_assert.ok(value1['image'].length > 10);
mod_assert.deepEqual(value1['present'], [ 'selma' ]);
mod_assert.deepEqual(value1['transformations'], { len: { selma: 5 } });

/* aggregating multiple data points */
value1 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.equal(10, value1['ymin']);
mod_assert.equal(20, value1['ymax']);
mod_assert.equal(200, value1['width']);
mod_assert.equal(150, value1['height']);
mod_assert.equal(10, value1['nbuckets']);
mod_assert.ok('image' in value1);
mod_assert.ok(typeof (value1['image']) == 'string');
mod_assert.ok(value1['image'].length > 10);
mod_assert.deepEqual(value1['present'].sort(), [ 'patty', 'selma' ]);
mod_assert.deepEqual(value1['transformations'],
    { len: { patty: 5, selma: 5 } });

/* selection should change the image */
delete (request.ca_params['hues']);
value2 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.notEqual(value1['image'], value2['image']);

request.ca_params['selected'] = [ 'patty' ];
value1 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.notEqual(value1['image'], value2['image']);
value2 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.equal(value1['image'], value2['image']);

request.ca_params['selected'] = [ 'patty', 'selma' ];
value1 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.notEqual(value1['image'], value2['image']);

/* isolate should change the image */
request.ca_params['selected'] = [ 'patty' ];
value1 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
request.ca_params['isolate'] = 'true';
value2 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.notEqual(value1['image'], value2['image']);

request.ca_params['isolate'] = 'false';
value2 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.equal(value1['image'], value2['image']);

/* exclude should change the image */
request.ca_params['selected'] = [ 'patty' ];
value1 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
request.ca_params['exclude'] = 'true';
value2 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.notEqual(value1['image'], value2['image']);

request.ca_params['exclude'] = 'false';
value2 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.equal(value1['image'], value2['image']);

/* rainbow should change the image */
request.ca_params['decompose_all'] = 'true';
request.ca_params['selected'] = [];
value2 = getval(mod_atl.dataset_both, 12345, 3, xform, request);
mod_assert.notEqual(value1['image'], value2['image']);

/* illegal to specify any combination of isolate, exclude, rainbow */
request.ca_params['decompose_all'] = 'true';
request.ca_params['isolate'] = 'true';
mod_assert.throws(function () {
	getval(mod_atl.dataset_both, 12345, 3, xform, request);
}, caValidationError);

request.ca_params['isolate'] = 'false';
request.ca_params['exclude'] = 'true';
mod_assert.throws(function () {
	getval(mod_atl.dataset_both, 12345, 3, xform, request);
}, caValidationError);

request.ca_params['decompose_all'] = 'false';
request.ca_params['isolate'] = 'true';
request.ca_params['exclude'] = 'true';
mod_assert.throws(function () {
	getval(mod_atl.dataset_both, 12345, 3, xform, request);
}, caValidationError);

request.ca_params['isolate'] = 'false';
getval(mod_atl.dataset_both, 12345, 3, xform, request);
