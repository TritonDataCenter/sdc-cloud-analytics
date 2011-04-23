/*
 * ca-agg.js: Utility functions and classes for aggregating data
 */

var mod_sys = require('sys');
var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('./ca-common');

/*
 * Given an instrumentation, returns an instance of caDataset for handling that
 * instrumentation's data.  See caDataset below for details.
 */
function caDatasetForInstrumentation(inst)
{
	var nsources, granularity;

	nsources = inst['nsources'];
	granularity = inst['granularity'];
	ASSERT(granularity > 0);

	ASSERT(inst['value-dimension'] > 0);
	ASSERT(inst['value-dimension'] <= 3);

	if (inst['value-dimension'] == 1)
		return (new caDatasetScalar(granularity, nsources));

	if (inst['value-dimension'] == 3) {
		ASSERT(inst['value-arity'] == mod_ca.ca_arity_numeric);
		return (new caDatasetHeatmapDecomp(granularity, nsources));
	}

	if (inst['value-arity'] == mod_ca.ca_arity_numeric)
		return (new caDatasetHeatmapScalar(granularity, nsources));

	return (new caDatasetDecomp(granularity, nsources));
}

exports.caDatasetForInstrumentation = caDatasetForInstrumentation;


/*
 * A dataset represents data collected by the aggregator for a particular
 * instrumentation over a specified period of time.  The base class caDataset
 * implements common functions like tracking the number of sources reporting for
 * this instrumentation, but caDataset itself is an abstract class and doesn't
 * manage the actual data.  That's handled by four subclasses:
 *
 *	caDatasetScalar		scalar values
 *
 *	caDatasetDecomp		simple discrete decompositions
 *
 *	caDatasetHeatmapScalar	heatmap values with no additional decomposition
 *
 *	caDatasetHeatmapDecomp	heatmap values with an additional decomposition
 *
 * Additionally, the caDatasetSimple class is used as a parent class of the
 * first three of these to provide functionality common to these
 * implementations.
 *
 * The methods provided by caDataset itself (and thus available for all
 * datasets) include:
 *
 *	update(source, time, datum)	Add new data to this dataset.
 *
 *	expireBefore(exptime)		Throws out data older than 'exptime'.
 *
 *	dataForTime(start)		Returns the raw data representation for
 *					the specified data point.
 *
 *	nsources()			Returns the total number of distinct
 *					sources which have ever reported data
 *					for this instrumentation.
 *
 *	nreporting(start, duration)	Returns the minimum number of sources
 *					which have reported data over the
 *					specified interval.  See nreporting()
 *					for details.
 *
 *	maxreporting(start, duration)	Returns the maximum number of sources
 *					which have reported data over the
 *					specified interval.  See maxreporting()
 *					for details.
 *
 *	normalizeInterval(start,	Returns an interval described with
 *	    duration			'start_time' and 'duration' properties
 *					that's aligned with this dataset's
 *					granularity.
 *
 * Heatmap datasets provide additional methods to retrieve data that's stored
 * more efficiently for the heatmap generator:
 *
 *	keysForTime(start, duration)	Returns an array of values of the
 *					discrete decomposition field that have
 *					non-zero values during the specified
 *					interval.
 *
 *	total()				Returns the data for all keys.  That is,
 *					the data at each time index is the sum
 *					of data over all keys at that time.
 *
 *	dataForKey(key)			Returns the data for a specific key.
 *
 * Note that the data accessors for the heatmap objects do not reference a
 * particular time.  They return data for all time.  This avoids having to
 * create a new object for each request for the specific time interval in the
 * request.  This works because node-heatmap can consume much more data than it
 * actually needs as long as the caller specifies which data to look at.
 */
function caDataset(granularity, nsources)
{
	this.cd_granularity = granularity;
	this.cd_nsources = nsources;
	this.cd_sources = {};
	this.cd_reporting = {};
}

/*
 * update(source, time, datum): Save the specified datum for the specified time
 * index into this dataset.  If data already exists for this time index, the new
 * datum will be combined with (added to) the existing data.
 *
 * This base class implementation updates our state about which sources are
 * reporting data for this instrumentation and then delegates the actual data
 * handling to subclasses via aggregateValue().
 */
caDataset.prototype.update = function (source, rawtime, datum)
{
	var time;

	if (!(source in this.cd_sources)) {
		this.cd_sources[source] = { s_last: rawtime };
	} else {
		this.cd_sources[source].s_last = Math.max(
		    this.cd_sources[source].s_last, rawtime);
	}

	/*
	 * We expect that we can get data at any point during an interval of
	 * size "granularity", but we only want to store it at intervals of
	 * size "granularity".  We map the received timestamp down to the
	 * previous aligned time.
	 */
	time = this.ptime(rawtime);

	if (!(time in this.cd_reporting))
		this.cd_reporting[time] = {};

	this.cd_reporting[time][source] = true;

	ASSERT(this.aggregateValue, 'caDataset is abstract');
	this.aggregateValue(time, datum);
};

/*
 * expireBefore(exptime): Removes data older than "exptime".  This base class
 * removes source-specific information but delegates to the subclass for
 * expiring the actual data.
 */
caDataset.prototype.expireBefore = function (exptime)
{
	var time;

	for (time in this.cd_reporting) {
		if (time >= exptime)
			continue;

		delete (this.cd_reporting[time]);
	}

	this.expireDataBefore(exptime);
};

/*
 * dataForTime(start, duration): Returns the raw data for the specified
 * interval.  The implementation is entirely subclass-specific.
 */
caDataset.prototype.dataForTime = function (start, duration)
{
	ASSERT(false, 'caDataset is abstract');
};

/*
 * nsources(): Returns the total number of sources reporting for this dataset.
 */
caDataset.prototype.nsources = function ()
{
	return (this.cd_nsources);
};

/*
 * nreporting(start, duration): Returns the minimum number of sources that
 * reported data during the specified interval.  Note that this doesn't mean
 * that there exist N sources that reported at every second during the interval.
 * It just means that at every second during the interval, at least N sources
 * reported.  For example consider a dataset with M total sources that reported
 * in a round-robin way so that exactly 1 source reports at each second.
 * nreporting(start, duration) returns 1 for any given interval, but it's not
 * the case that any of the M sources reported at every second during that
 * interval (unless the interval is exactly 1 second).
 *
 * This sounds complicated, but it's very easy to implement and the only thing
 * we're trying to convey is whether a given data point may be missing data
 * because some sources weren't reporting.  We're not trying to convey anything
 * about the overall health of the system.
 */
caDataset.prototype.nreporting = function (start, duration)
{
	var minval, value, time;

	if (!duration)
		duration = this.cd_granularity;

	ASSERT(start % this.cd_granularity === 0);
	ASSERT(duration % this.cd_granularity === 0);

	for (time = start; time < start + duration;
	    time += this.cd_granularity) {
		value = this.nReportingAt(time);

		if (minval == undefined) {
			minval = value;
			continue;
		}

		minval = Math.min(minval, value);
	}

	return (minval ? minval : 0);
};

/*
 * maxreporting(start, duration): Returns the maximum number of sources that
 * reported data during the specified interval.  See the caveat above about
 * nreporting(); this is the same function but takes the maximum over the
 * interval instead of the minimum to establish an upper bound on the number of
 * sources that reported over the given interval.
 */
caDataset.prototype.maxreporting = function (start, duration)
{
	var maxval, value, time;

	if (!duration)
		duration = 1;

	ASSERT(start % this.cd_granularity === 0);
	ASSERT(duration == 1 || duration % this.cd_granularity === 0);

	maxval = 0;
	for (time = start; time < start + duration;
	    time += this.cd_granularity) {
		value = this.nReportingAt(time);
		maxval = Math.max(maxval, value);
	}

	return (maxval);
};

/*
 * [private] Returns the number of sources reporting at this time
 */
caDataset.prototype.nReportingAt = function (time)
{
	ASSERT(time % this.cd_granularity === 0);

	if (!(time in this.cd_reporting))
		return (0);

	return (caNumProps(this.cd_reporting[time]));
};

/*
 * Given a "raw" timestamp (as may be supplied by the user), return the latest
 * timestamp before this time that lines up with the granularity of this
 * dataset.  For example, if the granularity is 60 seconds and the rawtime
 * represents 06:03:37, this returns 06:03:00.
 */
caDataset.prototype.ptime = function (rawtime)
{
	return (rawtime - (rawtime % this.cd_granularity));
};

/*
 * Given a "raw" timestamp (as may be supplied by an instrumenter), return the
 * earliest timestamp after this time that lines up with the granularity of this
 * dataset.  For example, if the granularity is 60 seconds and the rawtime
 * represents 06:03:37, this returns 06:04:00.
 */
caDataset.prototype.ntime = function (rawtime)
{
	if (rawtime % this.cd_granularity === 0)
		return (rawtime);

	return (this.ptime(rawtime) + this.cd_granularity);
};

caDataset.prototype.normalizeInterval = function (rawstart, rawduration)
{
	return ({
		start_time: this.ptime(rawstart),
		duration: this.ntime(rawduration)
	});
};

/*
 * Implements common functions for datasets whose data can be represented with
 * just an object mapping time-index to value.  This implementation is used for
 * scalars, simple discrete decompositions, and simple numeric decompositions.
 */
function caDatasetSimple(granularity, nsources, zero, add)
{
	caDataset.apply(this, [ granularity, nsources ]);
	this.cds_data = {};
	this.cds_zero = zero;
	this.cds_add = add;
}

caDatasetSimple.prototype = new caDataset();
mod_sys.inherits(caDatasetSimple, caDataset);

caDatasetSimple.prototype.expireDataBefore = function (exptime)
{
	var time;

	for (time in this.cds_data) {
		if (time >= exptime)
			continue;

		delete (this.cds_data[time]);
	}
};

caDatasetSimple.prototype.dataForTime = function (time)
{
	ASSERT(time % this.cd_granularity === 0);
	return (time in this.cds_data ? this.cds_data[time] : this.cds_zero);
};

caDatasetSimple.prototype.aggregateValue = function (time, datum)
{
	ASSERT(time % this.cd_granularity === 0);

	if (datum === undefined)
		datum = this.cds_zero;

	if (!(time in this.cds_data)) {
		this.cds_data[time] = datum;
		return;
	}

	this.cds_data[time] = this.cds_add(this.cds_data[time], datum);
};


/*
 * Implements datasets for scalar values.
 */
function caDatasetScalar(granularity, nsources)
{
	caDatasetSimple.apply(this, [ granularity, nsources, 0, caAddScalars ]);
}

caDatasetScalar.prototype = new caDatasetSimple();
mod_sys.inherits(caDatasetScalar, caDatasetSimple);


/*
 * Implements datasets for simple discrete decompositions.
 */
function caDatasetDecomp(granularity, nsources)
{
	caDatasetSimple.apply(this, [ granularity, nsources, {},
	    caAddDecompositions ]);
}

caDatasetDecomp.prototype = new caDatasetSimple();
mod_sys.inherits(caDatasetDecomp, caDatasetSimple);


/*
 * Implements datasets for heatmaps with no additional decompositions.
 */
function caDatasetHeatmapScalar(granularity, nsources)
{
	caDatasetSimple.apply(this, [ granularity, nsources, [],
	    caAddDistributions ]);
}

caDatasetHeatmapScalar.prototype = new caDatasetSimple();
mod_sys.inherits(caDatasetHeatmapScalar, caDatasetSimple);

caDatasetHeatmapScalar.prototype.total = function ()
{
	/*
	 * Yes, it's a little dirty to reach into our parent class here, but
	 * anything short of a major restructuring would be equally hokey.
	 */
	return (this.cds_data);
};

caDatasetHeatmapScalar.prototype.keysForTime = function (time)
{
	return ([]);
};

caDatasetHeatmapScalar.prototype.dataForKey = function (key)
{
	return ({});
};


/*
 * Implements a heatmap dataset with an additional discrete decomposition.  For
 * efficiency, we maintain three data structures:
 *
 *	distbykey	mapping of key -> time -> distribution
 *			This is the actual data for all time for each key.
 *
 *	totalsbytime	mapping of time -> distribution
 *			This is the actual data for all time summed over all
 *			keys.
 *
 *	keysbytime:	mapping of time -> list of keys with non-zero values
 *			This is used to quickly identify which elements of
 *			distbykey to look at for a particular time.
 *
 * This structure is more complicated than the Simple implementation above but
 * allows us to retrieve the input data for heatmap generation much more quickly
 * than the more straightforward representation would.
 */
function caDatasetHeatmapDecomp(granularity, nsources)
{
	caDataset.apply(this, [ granularity, nsources ]);
	this.cdh_distbykey = {};
	this.cdh_totalsbytime = {};
	this.cdh_keysbytime = {};
}

caDatasetHeatmapDecomp.prototype = new caDataset();
mod_sys.inherits(caDatasetHeatmapDecomp, caDataset);

caDatasetHeatmapDecomp.prototype.expireDataBefore = function (exptime)
{
	var time, key;

	for (time in this.cdh_keysbytime) {
		if (time >= exptime)
			continue;

		for (key in this.cdh_keysbytime[time]) {
			delete (this.cdh_distbykey[key][time]);

			if (caIsEmpty(this.cdh_distbykey[key]))
				delete (this.cdh_distbykey[key]);
		}

		delete (this.cdh_totalsbytime[time]);
		delete (this.cdh_keysbytime[time]);
	}
};

caDatasetHeatmapDecomp.prototype.dataForTime = function (start)
{
	var key, ret;

	ASSERT(start % this.cd_granularity === 0);

	if (!(start in this.cdh_keysbytime))
		return ({});

	ret = {};
	for (key in this.cdh_keysbytime[start])
		ret[key] = this.cdh_distbykey[key][start];

	return (ret);
};

caDatasetHeatmapDecomp.prototype.aggregateValue = function (time, datum)
{
	var key;

	ASSERT(time % this.cd_granularity === 0);

	if (datum === undefined)
		return;

	ASSERT(datum.constructor == Object);

	/*
	 * If we've never seen anything at this time before, initialize the
	 * by-time mappings.  They must be consistent with respect to keys.
	 */
	if (!(time in this.cdh_keysbytime)) {
		this.cdh_keysbytime[time] = {};
		ASSERT(!(time in this.cdh_totalsbytime));
		this.cdh_totalsbytime[time] = [];
	}

	/*
	 * Update the per-key distributions and totals for this time period.
	 */
	for (key in datum) {
		ASSERT(datum[key].constructor == Array);

		this.cdh_keysbytime[time][key] = true;

		if (!(key in this.cdh_distbykey))
			this.cdh_distbykey[key] = {};

		if (!(time in this.cdh_distbykey[key])) {
			this.cdh_distbykey[key][time] = datum[key];
		} else {
			this.cdh_distbykey[key][time] = caAddDistributions(
			    this.cdh_distbykey[key][time], datum[key]);
		}

		this.cdh_totalsbytime[time] = caAddDistributions(
		    this.cdh_totalsbytime[time], datum[key]);
	}
};

caDatasetHeatmapDecomp.prototype.keysForTime = function (start, duration)
{
	var time, key, keys;

	ASSERT(start % this.cd_granularity === 0);
	ASSERT(duration % this.cd_granularity === 0);

	keys = {};

	for (time = start; time < start + duration;
	    time += this.cd_granularity) {
		if (!(time in this.cdh_keysbytime))
			continue;

		for (key in this.cdh_keysbytime[time])
			keys[key] = true;
	}

	return (Object.keys(keys));
};

caDatasetHeatmapDecomp.prototype.dataForKey = function (key)
{
	if (!(key in this.cdh_distbykey))
		return ({});

	return (this.cdh_distbykey[key]);
};

caDatasetHeatmapDecomp.prototype.total = function ()
{
	return (this.cdh_totalsbytime);
};


/*
 * The caAdd{Scalars,Decompositions,Distributions} family of functions implement
 * addition of instrumentation values, be they scalars (simple addition),
 * decompositions (add correspond members), or distributions (add corresponding
 * intervals).  These functions are invoked with two non-null arguments: a
 * left-hand-side and right-hand-side, and return their sum.  These functions
 * are allowed to modify the left-hand-side, but they must still return the sum.
 */
function caAddScalars(lhs, rhs)
{
	return (lhs + rhs);
}

exports.caAddScalars = caAddScalars;


function caAddDistributions(lhs, rhs)
{
	var newdist, ll, rr;

	ASSERT(lhs.constructor == Array);
	ASSERT(rhs.constructor == Array);

	newdist = [];

	/*
	 * We assume here that the ranges from both distributions exactly align
	 * (which is currently true since we use fixed lquantize() parameters on
	 * the backend) and that the ranges are sorted in both distributions.
	 */
	for (ll = 0, rr = 0; rr < rhs.length; rr++) {
		/*
		 * Scan the old distribution until we find a range not before
		 * the current range from the new distribution.
		 */
		while (ll < lhs.length && lhs[ll][0][0] < rhs[rr][0][0]) {
			ASSERT(lhs[ll][0][1] < rhs[rr][0][1]);
			newdist.push(lhs[ll++]);
		}

		/*
		 * If we find a range that matches exactly, just add the values.
		 */
		if (ll < lhs.length && lhs[ll][0][0] == rhs[rr][0][0]) {
			ASSERT(lhs[ll][0][1] == rhs[rr][0][1]);
			newdist.push(
			    [ lhs[ll][0], lhs[ll][1] + rhs[rr][1] ]);
			ll++;
			continue;
		}

		/*
		 * The current range in the new distribution doesn't match any
		 * existing range in the old distribution, so just insert the
		 * new data point wherever we are (which may be the end of the
		 * old distribution).  We create a new data point consisting of
		 * a reference to the range in the new distribution (ranges are
		 * immutable) and a copy of the range's value.
		 */
		newdist.push(rhs[rr]);
	}

	while (ll < lhs.length)
		newdist.push(lhs[ll++]);

	return (newdist);
}

exports.caAddDistributions = caAddDistributions;


function caAddDecompositions(lhs, rhs, adder)
{
	var subkey;

	/*
	 * We allow the caller to specify an optional "adder" argument to use to
	 * specify how to combine individual values inside the decomposition.
	 */
	if (!adder)
		adder = caAddScalars;

	ASSERT(lhs.constructor == Object);
	ASSERT(rhs.constructor == Object);

	for (subkey in rhs) {
		if (!lhs[subkey]) {
			lhs[subkey] = rhs[subkey];
			continue;
		}

		lhs[subkey] = adder(lhs[subkey], rhs[subkey]);
	}

	return (lhs);
}

exports.caAddDecompositions = caAddDecompositions;
