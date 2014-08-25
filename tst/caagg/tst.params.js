/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * tst.params.js: test parameter processing in the aggregator
 */

var mod_assert = require('assert');
var mod_agg = require('../../lib/ca/ca-agg');

var hues;

hues = mod_agg.caAggrHeatmapHues(5, true);
mod_assert.equal(hues.length, 5);

hues = mod_agg.caAggrHeatmapHues(5, false);
mod_assert.equal(hues.length, 6);

hues = mod_agg.caAggrHeatmapHues(0, false);
mod_assert.equal(hues.length, 1);

hues = mod_agg.caAggrHeatmapHues(0, true);
mod_assert.equal(hues.length, 0);
