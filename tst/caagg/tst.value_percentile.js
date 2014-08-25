/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Tests caAggrValueHeatmapPercentile
 */

var mod_assert = require('assert');
var mod_agg = require('../../lib/ca/ca-agg');
var mod_atl = require('./aggtestlib');

var getval = mod_agg.caAggrHeatmapPercentileImpl.ai_value;
var xform = mod_atl.xform;
var request = { ca_params: {} };
var value1;

mod_atl.dataset_numeric.update('source', 12345, [[[1, 100], 100000]]);

request.ca_params['percentile'] = 0;
value1 = getval(mod_atl.dataset_numeric, 12345, 1, xform, request);
console.log(value1);
mod_assert.equal(0, value1['percentile']);

request.ca_params['percentile'] = 1;
value1 = getval(mod_atl.dataset_numeric, 12345, 1, xform, request);
console.log(value1);
mod_assert.ok(Math.abs(value1['percentile'] - 102) < 0.01);

request.ca_params['percentile'] = 0.5;
value1 = getval(mod_atl.dataset_numeric, 12345, 1, xform, request);
console.log(value1);
mod_assert.ok(Math.abs(value1['percentile'] - 51) < 0.01);

request.ca_params['percentile'] = 0.95;
value1 = getval(mod_atl.dataset_numeric, 12345, 1, xform, request);
console.log(value1);
mod_assert.ok(Math.abs(value1['percentile'] - 96) < 0.01);
