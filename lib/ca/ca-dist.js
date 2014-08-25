/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * ca-dist.js: implements caDistr interface for various types
 *
 * caDistr is an interface defining a single function:
 *
 *	value()		Returns a value.
 *
 * Implementations place additional constraints on returned values.
 */

var mod_assert = require('assert');

/*
 * Distribution whose values are uniformly distributed in the range [min, max).
 */
function caDistrUniform(min, max)
{
	this.cdu_min = min;
	this.cdu_max = max;
}

caDistrUniform.prototype.value = function ()
{
	return (this.cdu_min +
	    Math.round(Math.random() * (this.cdu_max - this.cdu_min)));
};

/*
 * Distribution which keeps track of recent values and returns either a new
 * value within 5% of the previous value or else a uniformly distributed value.
 */
function caDistrMemory(min, max)
{
	this.cdm_min = min;
	this.cdm_max = max;
	this.cdm_psame = 0.95;	/* 95% of the time */
	this.cdm_range = 0.1;	/* stay within 5% of previous value */
}

caDistrMemory.prototype.value = function ()
{
	if (this.cdm_value === undefined || Math.random() > this.cdm_psame) {
		this.cdm_value = this.cdm_min +
		    Math.ceil(Math.random() * (this.cdm_max - this.cdm_min));
		return (this.cdm_value);
	}

	this.cdm_value = Math.round(this.cdm_value *
	    (1 + ((Math.random() * this.cdm_range) - this.cdm_range / 2)));
	this.cdm_value = Math.min(this.cdm_value, this.cdm_max);
	this.cdm_value = Math.max(this.cdm_value, this.cdm_min);
	return (this.cdm_value);
};

/*
 * Normal distribution with standard deviation 10% of the mean (by default).
 */
function caDistrNormal(mean, factor)
{
	if (!factor)
		factor = 0.1;
	this.cdn_mean = mean;
	this.cdn_stddev = mean * factor;
}

caDistrNormal.prototype.value = function ()
{
	var x1, x2, vv;

	/*
	 * This method uses the Box-Muller transformation from a pair of
	 * uniformly distributed values to a pair of Gaussian-distributed values
	 * (or one, in this case).  We then scale by the standard deviation and
	 * add the mean to generalize.  This could be made faster.
	 */
	x1 = Math.random();
	x2 = Math.random();
	vv = Math.sqrt(-2 * Math.log(x1)) * Math.sin(2 * Math.PI * x2);
	return (Math.max(Math.round(vv * this.cdn_stddev + this.cdn_mean), 0));
};

/*
 * Distribution made up of other distributions with defined probabilities for
 * each one.  An example might be a distribution which uses a uniform
 * distribution between 0 and 1 with probability 0.8 and a normal distribution
 * of mean 300 with probability 0.2.  The sole argument is an array of other
 * distributions, each being an object with these properties:
 *
 *	dist	distribution implementation
 *
 *	pp	probability of choosing this distribution
 */
function caDistrMulti(distrs)
{
	var ii, sum;

	sum = 0;
	mod_assert.ok(distrs.length > 0);

	for (ii = 0; ii < distrs.length - 1; ii++) {
		mod_assert.ok('pp' in distrs[ii]);
		mod_assert.ok('dist' in distrs[ii]);
		sum += distrs[ii]['pp'];
	}

	mod_assert.ok('dist' in distrs[distrs.length - 1]);
	mod_assert.ok(sum <= 1);

	this.cdm_distrs = caDeepCopy(distrs);
}

caDistrMulti.prototype.value = function ()
{
	var rand, ii, cm;

	cm = 0;
	rand = Math.random();
	for (ii = 0; ii < this.cdm_distrs.length - 1; ii++) {
		cm += this.cdm_distrs[ii]['pp'];
		if (rand < cm)
			break;
	}

	return (this.cdm_distrs[ii]['dist'].value());
};

exports.caDistrUniform = caDistrUniform;
exports.caDistrMemory = caDistrMemory;
exports.caDistrNormal = caDistrNormal;
exports.caDistrMulti = caDistrMulti;
