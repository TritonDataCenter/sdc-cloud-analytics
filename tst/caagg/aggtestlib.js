/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Common values used by multiple tests.
 */

var mod_ca = require('../../lib/ca/ca-common');
var mod_agg = require('../../lib/ca/ca-agg');

exports.spec_scalar = {
    'value-arity': mod_ca.ca_arity_scalar,
    'value-dimension': 1,
    'value-scope': 'interval',
    'granularity': 1
};

exports.spec_discrete = {
    'value-arity': mod_ca.ca_arity_discrete,
    'value-dimension': 2,
    'value-scope': 'interval',
    'granularity': 1
};

exports.spec_numeric = {
    'value-arity': mod_ca.ca_arity_numeric,
    'value-dimension': 2,
    'value-scope': 'interval',
    'granularity': 1
};

exports.spec_both = {
    'value-arity': mod_ca.ca_arity_numeric,
    'value-dimension': 3,
    'value-scope': 'interval',
    'granularity': 1
};

exports.dataset_scalar = mod_agg.caDatasetForInstrumentation(
    exports.spec_scalar);
exports.dataset_discrete = mod_agg.caDatasetForInstrumentation(
    exports.spec_discrete);
exports.dataset_numeric = mod_agg.caDatasetForInstrumentation(
    exports.spec_numeric);
exports.dataset_both = mod_agg.caDatasetForInstrumentation(
    exports.spec_both);

exports.xform = function (keys)
{
	var ii, ret = { len: {} };

	for (ii = 0; ii < keys.length; ii++)
		ret['len'][keys[ii]] = keys[ii].length;

	return (ret);
};
