/*
 * Tests caAggrValueHeatmapAverage
 */

var mod_assert = require('assert');
var mod_agg = require('../../lib/ca/ca-agg');
var mod_atl = require('./aggtestlib');

var getval = mod_agg.caAggrHeatmapAverageImpl.ai_value;
var xform = mod_atl.xform;
var request = { ca_params: {} };
var value1;

/*
 * Simple numeric decomposition heatmaps.
 */
mod_atl.dataset_numeric.update('source', 12345, [[[1, 100], 100000]]);
value1 = getval(mod_atl.dataset_numeric, 12345, 1, xform, request);
mod_assert.ok(Math.abs(value1['average'] - 51) < 0.01);
