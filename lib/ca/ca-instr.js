/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * ca-instr.js: instrumenter service helper functions
 */

var mod_assert = require('assert');

var mod_ca = require('./ca-common');
var mod_capred = require('./ca-pred');

/*
 * Utility function for in-memory metrics to apply a predicate to a list of data
 * points.  Data points are represented as objects with two members:
 *
 *	fields		object mapping each field of a given metric to some
 *			value of that field (e.g., "zonename": "ca")
 *
 *	value		value of the base metric for this data point
 *
 * This function returns the set of datapoints for which the predicate evaluates
 * to "true".
 */
function caInstrApplyPredicate(predicate, datapoints)
{
	return (datapoints.filter(function (point) {
		return (mod_capred.caPredEval(predicate, point['fields']));
	}));
}

/*
 * Given a set of datapoints (described above), a list of fields representing a
 * decomposition, and an array of bucketizers for the numeric fields, compute
 * the value by adding fields which are not being decomposed.
 */
function caInstrComputeValue(metadata, bucketizers, decomps, datapts)
{
	return (caInstrComputeValueFrom(metadata, bucketizers, decomps,
	    datapts, 0));
}

function caInstrComputeValueFrom(metadata, bucketizers, decomps, datapts, ii)
{
	var arity, rv, key, fieldvalues, subdata, jj;

	/*
	 * Simple case: scalar values.  Just add them up.
	 */
	if (ii >= decomps.length) {
		return (datapts.reduce(function (sum, elt) {
			return (sum + elt['value']);
		}, 0));
	}

	arity = metadata.fieldArity(decomps[ii]);
	if (arity == mod_ca.ca_field_arity_numeric) {
		/* numeric decompositions must be last */
		mod_assert.equal(ii, decomps.length - 1);
		mod_assert.ok(decomps[ii] in bucketizers);

		rv = [];
		for (jj = 0; jj < datapts.length; jj++) {
			bucketizers[decomps[ii]](rv,
			    datapts[jj]['fields'][decomps[ii]],
			    datapts[jj]['value']);
		}

		return (rv);
	}

	mod_assert.equal(arity, mod_ca.ca_field_arity_discrete);
	mod_assert.ok(!(decomps[ii] in bucketizers));

	rv = {};
	fieldvalues = {};
	for (jj = 0; jj < datapts.length; jj++) {
		key = datapts[jj]['fields'][decomps[ii]];
		fieldvalues[key] = true;
	}

	/* XXX this is terribly inefficient */
	for (key in fieldvalues) {
		subdata = datapts.filter(function (elt) {
			return (elt['fields'][decomps[ii]] == key);
		});

		rv[key] = caInstrComputeValueFrom(metadata, bucketizers,
		    decomps, subdata, ii + 1);
	}

	return (rv);
}

function caInstrLinearBucketize(step)
{
	return (function (rv, value, card) {
		return (caLinearBucketize(rv, value, card, step));
	});
}

function caLinearBucketize(rv, value, card, step)
{
	var ii, ent;

	for (ii = 0; ii < rv.length; ii++) {
		if (value >= rv[ii][0][0] && value <= rv[ii][0][1]) {
			rv[ii][1] += card;
			return;
		}

		if (value < rv[ii][0][0])
			break;
	}

	mod_assert.ok(ii == rv.length || value < rv[ii][0][0]);
	mod_assert.ok(ii === 0 || value > rv[ii - 1][0][1]);

	ent = [ [ 0, 0 ], card ];
	ent[0][0] = Math.floor(value / step) * step;
	ent[0][1] = ent[0][0] + step - 1;
	rv.splice(ii, 0, ent);
	return (rv);
}

function caInstrLogLinearBucketize(base, min, max, nbuckets)
{
	return (function (rv, value, card) {
		return (caLogLinearBucketize(rv, value, card, base, min, max,
		    nbuckets));
	});
}

function caLogLinearBucketize(rv, value, card, base, min, max, nbuckets)
{
	var ii, ent, logbase, step, offset;

	for (ii = 0; ii < rv.length; ii++) {
		if (value >= rv[ii][0][0] && value <= rv[ii][0][1]) {
			rv[ii][1] += card;
			return;
		}

		if (value < rv[ii][0][0])
			break;
	}

	mod_assert.ok(ii == rv.length || value < rv[ii][0][0]);
	mod_assert.ok(ii === 0 || value > rv[ii - 1][0][1]);

	ent = [ [ 0, 0 ], card ];

	if (value < Math.pow(base, min)) {
		ent[0][0] = 0;
		ent[0][1] = Math.pow(base, min);
	} else {
		logbase = caLogFloor(base, value);
		step = Math.pow(base, logbase + 1) / nbuckets;
		offset = value - Math.pow(base, logbase);

		ent[0][0] = Math.pow(base, logbase) +
		    (Math.floor(offset / step) * step);
		ent[0][1] = ent[0][0] + step - (step / base);
	}

	rv.splice(ii, 0, ent);
	return (rv);
}

/*
 * Essentially computes Math.floor(logbase(base, value)), where
 * logbase(base, value) is the log-base-"base" of value.
 */
function caLogFloor(base, input)
{
	var value, exp;

	exp = 0;
	value = input;
	for (exp = 0; value >= base; exp++)
		value /= base;

	return (exp);
}

exports.caInstrApplyPredicate = caInstrApplyPredicate;
exports.caInstrComputeValue = caInstrComputeValue;
exports.caInstrLinearBucketize = caInstrLinearBucketize;
exports.caInstrLogLinearBucketize = caInstrLogLinearBucketize;
