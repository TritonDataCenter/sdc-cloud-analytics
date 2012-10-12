/*
 * ca-agg.js: Utility functions and classes for aggregating data
 */

var mod_sys = require('sys');
var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('./ca-common');
var mod_heatmap;

/*
 * Given an instrumentation, returns an instance of caDataset for handling that
 * instrumentation's data.  See caDataset below for details.
 */
function caDatasetForInstrumentation(inst)
{
	var nsources, granularity, doadd, cons;

	nsources = inst['nsources'];
	granularity = inst['granularity'];
	ASSERT(granularity > 0);

	ASSERT(inst['value-dimension'] > 0);
	ASSERT(inst['value-dimension'] <= 3);

	doadd = !('value-scope' in inst) || inst['value-scope'] == 'interval';

	if (inst['value-dimension'] == 1) {
		cons = caDatasetScalar;
	} else if (inst['value-dimension'] == 3) {
		ASSERT(inst['value-arity'] == mod_ca.ca_arity_numeric);
		cons = caDatasetHeatmapDecomp;
	} else if (inst['value-arity'] == mod_ca.ca_arity_numeric) {
		cons = caDatasetHeatmapScalar;
	} else {
		cons = caDatasetDecomp;
	}

	return (new cons(granularity, nsources, doadd));
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
 *	dataForTime(start, duration)	Returns the raw data representation for
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
 *	stash()				Returns a serialized representation of
 *					the dataset's data for passing to
 *					unstash().
 *
 *	unstash(data)			Given a serialized representation as
 *					returned by a previous call to stash(),
 *					load the specified data into this
 *					dataset.  This data will be combined
 *					with other data already stored in the
 *					dataset.
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
function caDataset(granularity, nsources, doadd)
{
	this.cd_granularity = granularity;
	this.cd_nsources = nsources;
	this.cd_sources = {};
	this.cd_reporting = {};
	this.cd_vers_major = 0;
	this.cd_vers_minor = 1;
	this.cd_doadd = doadd;
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

	/*
	 * If this source has already reported data for this time period and
	 * we're not supposed to add multiple data points, then we just ignore
	 * the new data point.
	 */
	if (this.cd_reporting[time][source] && !this.cd_doadd)
		return;

	this.cd_reporting[time][source] = true;

	ASSERT(this.aggregateValue, 'caDataset is abstract');
	this.aggregateValue(time, datum);
};

/*
 * updateSources(nsources): update the total number of sources expected.
 */
caDataset.prototype.updateSources = function (nsources)
{
	this.cd_nsources = nsources;
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

caDataset.prototype.stash = function ()
{
	var metadata, data, time;

	metadata = {
	    ca_agg_stash_vers_major: this.cd_vers_major,
	    ca_agg_stash_vers_minor: this.cd_vers_minor
	};

	data = {
	    cs_granularity: this.cd_granularity,
	    cs_nsources: this.cd_nsources,
	    cs_sources: this.cd_sources,
	    cs_data: {}
	};

	for (time in this.cd_reporting) {
		data.cs_data[time] = {
		    reporting: this.cd_reporting[time],
		    datum: this.dataForTime(time, this.cd_granularity)
		};
	}

	return ({ metadata: metadata, data: data });
};

caDataset.prototype.unstash = function (metadata, data)
{
	var host, source, time;

	if (metadata.ca_agg_stash_vers_major != this.cd_vers_major)
		throw (new caError(ECA_INCOMPAT));

	if (data.cs_granularity != this.cd_granularity)
		throw (new caError(ECA_INVAL, null,
		    'expected granularity %s, but found %s',
		    this.cd_granularity, data.cs_granularity));

	this.cd_nsources = Math.max(this.cd_nsources, data.cs_nsources);

	for (host in data.cs_sources) {
		source = data.cs_sources[host];

		if (!(host in this.cd_sources)) {
			this.cd_sources[host] = source;
			continue;
		}

		this.cd_sources[host].s_last = Math.max(
		    this.cd_sources[host].s_last, source.s_last);
	}

	for (time in data.cs_data) {
		ASSERT(time % this.cd_granularity === 0);

		if (!(time in this.cd_reporting))
			this.cd_reporting[time] = {};

		for (host in data.cs_data[time]['reporting'])
			this.cd_reporting[time][host] = true;

		this.aggregateValue(time, data.cs_data[time]['datum']);
	}
};

/*
 * Implements common functions for datasets whose data can be represented with
 * just an object mapping time-index to value.  This implementation is used for
 * scalars, simple discrete decompositions, and simple numeric decompositions.
 */
function caDatasetSimple(granularity, nsources, doadd, zero, add)
{
	caDataset.apply(this, [ granularity, nsources, doadd ]);
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

caDatasetSimple.prototype.dataForTime = function (start, duration)
{
	var time, value;

	mod_assert.equal(start % this.cd_granularity, 0);
	mod_assert.equal(duration % this.cd_granularity, 0);
	ASSERT(duration > 0);

	if (!this.cd_doadd)
		duration = this.cd_granularity;

	value = caDeepCopy(this.cds_zero);

	for (time = start; time < start + duration;
	    time += this.cd_granularity) {
		if (!(time in this.cds_data))
			continue;

		value = this.cds_add(value, this.cds_data[time]);
	}

	return (value);
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
function caDatasetScalar(granularity, nsources, doadd)
{
	caDatasetSimple.apply(this, [ granularity, nsources, doadd,
	    0, caAddScalars ]);
}

caDatasetScalar.prototype = new caDatasetSimple();
mod_sys.inherits(caDatasetScalar, caDatasetSimple);


/*
 * Implements datasets for simple discrete decompositions.
 */
function caDatasetDecomp(granularity, nsources, doadd)
{
	caDatasetSimple.apply(this, [ granularity, nsources, doadd,
	    {}, caAddDecompositions ]);
}

caDatasetDecomp.prototype = new caDatasetSimple();
mod_sys.inherits(caDatasetDecomp, caDatasetSimple);


/*
 * Implements datasets for heatmaps with no additional decompositions.
 */
function caDatasetHeatmapScalar(granularity, nsources, doadd)
{
	caDatasetSimple.apply(this, [ granularity, nsources, doadd,
	    [], caAddDistributions ]);
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
function caDatasetHeatmapDecomp(granularity, nsources, doadd)
{
	caDataset.apply(this, [ granularity, nsources, doadd ]);
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

caDatasetHeatmapDecomp.prototype.dataForTime = function (start, duration)
{
	var key, time, value;

	ASSERT(start % this.cd_granularity === 0);
	ASSERT(duration % this.cd_granularity === 0);

	if (!this.cd_doadd)
		duration = this.cd_granularity;

	value = {};

	for (time = start; time < start + duration;
	    time += this.cd_granularity) {
		if (!(time in this.cdh_keysbytime))
			continue;

		for (key in this.cdh_keysbytime[time]) {
			if (!(key in value))
				value[key] = [];

			value[key] = caAddDistributions(value[key],
			    this.cdh_distbykey[key][time]);
		}
	}

	return (value);
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
			/*
			 * In rare instances, we've seen this assertion blown,
			 * but we haven't had enough information to know why.
			 * For now we log additional debug information to try to
			 * catch this bug next time it happens.
			 */
			if (lhs[ll][0][1] != rhs[rr][0][1]) {
				console.error('lhs = %j', lhs);
				console.error('rhs = %j', rhs);
				console.error('ll = %d, rr = %d', ll, rr);
				console.error('lhs part = %j, rhs part = %j',
				    lhs[ll], rhs[rr]);
			}
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

/*
 * Return the time interval (as a tuple of "start_time" and "duration")
 * described by the given combination of start_time, duration, and end_time
 * parameters.
 */
function caAggrInterval(params, now, default_duration, granularity)
{
	var start, duration, end;

	start = params['start_time'];
	duration = params['duration'];
	end = params['end_time'];

	if (duration === undefined &&
	    (start === undefined || end === undefined))
		duration = default_duration;

	if (end !== undefined) {
		if (start === undefined && duration !== undefined) {
			if (duration > end)
				throw (new caValidationError(
				    '"duration" cannot exceed "end_time"'));

			start = end - duration;
		} else if (start !== undefined && duration === undefined) {
			if (end <= start)
				throw (new caValidationError('"end_time" ' +
				    'must be later than "start_time"'));

			duration = end - start;
		} else if (start !== undefined && duration !== undefined &&
		    start + duration !== end) {
			throw (new caValidationError(caSprintf('"start_time" ' +
			    '+ "duration" must equal "end_time"')));
		}

		ASSERT(start !== undefined);
		ASSERT(duration !== undefined);
		ASSERT(duration > 0);
		ASSERT(start + duration === end);
	} else if (start === undefined) {
		ASSERT(duration !== undefined);
		start = parseInt(now / 1000, 10) - duration - granularity;
	}

	ASSERT(duration !== undefined);

	if (duration < 1)
		throw (new caValidationError('"duration" must be positive'));

	return ({ start_time: start, duration: duration });
}

exports.caAggrInterval = caAggrInterval;


/*
 * The caAggrValue* family of functions implement the following interface:
 *
 *	func(dataset, start_time, duration, xform, request)
 *
 *	    Given a "dataset" instance (see above), a data point specified by
 *	    "start_time" and "duration" (which satifies the granularity
 *	    constraints of the dataset), and the HTTP request for this data
 *	    (which may contain additional parameters), return an object
 *	    representing the value of this data point.  The form of this value
 *	    is entirely implementation-specific.  "xform" may be used to
 *	    transform objects as appropriate.
 */

/*
 * Returns raw data for the specified data points.
 */
function caAggrValueRaw(dataset, start, duration, xform)
{
	var value, keys;

	value = dataset.dataForTime(start, duration);
	keys = (typeof (value) == 'object' && value.constructor == Object) ?
	    Object.keys(value) : [];

	return ({
	    value: value,
	    transformations: xform(keys)
	});
}

/*
 * Generates a heatmap image for the specified data points.
 */
function caAggrValueHeatmapImage(dataset, start, duration, xform, request)
{
	var param, conf, selected, isolate, exclude, rainbow, count;
	var ret, ii, present, datasets, buffer, png, tk;

	if (!mod_heatmap)
		mod_heatmap = require('heatmap');

	tk = new mod_ca.caTimeKeeper();

	/*
	 * Retrieve and validate parameters.
	 */
	param = mod_ca.caHttpParam.bind(null,
	    caAggrHeatmapParams, request.ca_params);
	selected = param('selected');
	isolate = param('isolate');
	exclude = param('exclude');
	rainbow = param('decompose_all');
	conf = caAggrHeatmapConf(request, start, duration, isolate,
	    selected.length);
	conf.step = dataset.normalizeInterval(0, 0.1)['duration'];

	count = 0;
	if (isolate)
		count++;
	if (exclude)
		count++;
	if (rainbow)
		count++;

	if (count > 1)
		throw (new caValidationError(
		    'only one of "isolate", "exclude", and ' +
		    '"decompose_all" may be specified'));

	/*
	 * Extract data from the dataset, bucketize it, and generate a heatmap.
	 */
	present = dataset.keysForTime(start, duration);

	if (rainbow)
		selected = present.sort();

	datasets = [];
	datasets.push(dataset.total());

	for (ii = 0; ii < selected.length; ii++)
		datasets.push(dataset.dataForKey(selected[ii]));

	for (ii = 0; ii < datasets.length; ii++)
		datasets[ii] = mod_heatmap.bucketize(datasets[ii], conf);

	if (!conf.hue)
		conf.hue = caAggrHeatmapHues(datasets.length - 1, isolate);

	if (isolate) {
		datasets.shift();

		if (datasets.length === 0) {
			datasets = [ mod_heatmap.bucketize({}, conf) ];
			conf.hue = [ 0 ];
		}
	} else {
		for (ii = 1; ii < datasets.length; ii++)
			mod_heatmap.deduct(datasets[0], datasets[ii]);

		if (exclude)
			datasets = [ datasets[0] ];
	}

	tk.step('up to bucketize + deduction');

	/*
	 * We can have more than the expected number of hues here because we
	 * won't always have entries for an empty dataset or because the user
	 * simply provided more hues than were necessary.
	 */
	ASSERT(conf.hue.length >= datasets.length);
	conf.hue = conf.hue.slice(0, datasets.length);
	mod_heatmap.normalize(datasets, conf);
	tk.step('normalize');

	conf.base = 0;
	conf.saturation = [ 0, 0.9 ];
	conf.value = 0.95;
	png = mod_heatmap.generate(datasets, conf);
	tk.step('generate');

	buffer = png.encodeSync();
	tk.step('png encoding');

	ret = {};
	caAggrValueHeatmapCommon(ret, conf);
	ret['ymin'] = conf.min;
	ret['ymax'] = conf.max;
	ret['present'] = present;
	ret['transformations'] = xform(ret['present']);
	ret['image'] = buffer.toString('base64');
	tk.step('value generation');

	return (ret);
}

function caAggrValueHeatmapDetails(dataset, start, duration, xform, request)
{
	var conf, detconf, xx, yy, param;
	var range, present, ii, ret, value;

	if (!mod_heatmap)
		mod_heatmap = require('heatmap');

	param = mod_ca.caHttpParam.bind(null,
	    caAggrHeatmapParams, request.ca_params);

	conf = caAggrHeatmapConf(request, start, duration, false, 0);
	xx = param('x');
	yy = param('y');

	if (!conf.max)
		throw (new caValidationError('"ymax" must be specified'));

	if (xx >= conf.width)
		throw (new caValidationError('"x" must be less than "width"'));

	if (yy >= conf.height)
		throw (new caValidationError('"y" must be less than "height"'));

	range = mod_heatmap.samplerange(xx, yy, conf);
	range[0] = dataset.normalizeInterval(range[0], duration)['start_time'];

	ret = {};
	caAggrValueHeatmapCommon(ret, conf);
	ret.bucket_time = range[0];
	ret.bucket_ymin = range[1][0];
	ret.bucket_ymax = range[1][1];

	detconf = {
		base: range[0],
		min: range[1][0],
		max: range[1][1],
		nbuckets: 1,
		nsamples: 1
	};

	/*
	 * Our goal is to return the sum of values at a particular point as well
	 * as the actual decomposition of values.  Recall that these values can
	 * be fractional in cases where the underlying data included intervals
	 * larger than the bucket size because in those cases we assign the
	 * values proportionally to the buckets in the interval.  We'd rather
	 * avoid presenting this detail to the user, since it doesn't generally
	 * matter and can be rather confusing, so we always want to present
	 * integer values for both the total and decompositions.  We could
	 * simply round both the total and component values, but then we could
	 * run into paradoxical situations in which the user sees non-zero data
	 * in the heatmap but the total and components all round to zero so the
	 * decomposition contains no data.  You could also wind up in situations
	 * where the total didn't match the sum of the components because of
	 * rounding errors.  To keep our lives simple, we say that the value for
	 * each non-zero component is the maximum of 1 and the rounded value
	 * from the underlying data, and the total is defined as the sum of the
	 * components.  This works reasonably for cases where we have a
	 * decomposition; in those where we don't, we apply the same rounded-
	 * but-at-least-one rule to derive the total directly from the data.
	 */
	present = dataset.keysForTime(range[0], duration);
	ret.present = {};

	if (present.length === 0) {
		/*
		 * Maybe there's no data here, or maybe there's just no
		 * decomposition.  Either way, calculate the total separately.
		 */
		value = mod_heatmap.bucketize(dataset.total(), detconf)[0][0];
		if (value === 0)
			ret.total = 0;
		else
			ret.total = Math.max(1, Math.round(value));
	} else {
		ret.total = 0;

		for (ii = 0; ii < present.length; ii++) {
			value = mod_heatmap.bucketize(
			    dataset.dataForKey(present[ii]), detconf)[0][0];

			if (!value)
				continue;

			value = Math.max(1, Math.round(value));
			ret.present[present[ii]] = value;
			ret.total += value;
		}
	}

	return (ret);
}

function caAggrValueHeatmapAverage(dataset, start, duration, xform, request)
{
	var conf, value, ret, map;

	if (!mod_heatmap)
		mod_heatmap = require('heatmap');

	conf = caAggrHeatmapConf(request, start, duration, false, 0);
	conf.step = dataset.normalizeInterval(0, 0.1)['duration'];

	ret = {};
	caAggrValueHeatmapCommon(ret, conf);

	conf.base = start;
	conf.nsamples = duration;
	map = mod_heatmap.bucketize(dataset.total(), conf);
	value = mod_heatmap.average(map, conf);
	ret['average'] = value[0][1]; /* XXX */

	return (ret);
}

function caAggrValueHeatmapPercentile(dataset, start, duration, xform, request)
{
	var conf, param, value, ret, map, pctile;

	if (!mod_heatmap)
		mod_heatmap = require('heatmap');

	param = mod_ca.caHttpParam.bind(null,
	    caAggrHeatmapParams, request.ca_params);
	pctile = param('percentile');

	conf = caAggrHeatmapConf(request, start, duration, false, 0);
	conf.step = dataset.normalizeInterval(0, 0.1)['duration'];

	ret = {};
	caAggrValueHeatmapCommon(ret, conf);

	conf.base = start;
	conf.nsamples = duration;
	map = mod_heatmap.bucketize(dataset.total(), conf);
	conf.percentile = pctile;
	value = mod_heatmap.percentile(map, conf);
	ret['percentile'] = value[0][1]; /* XXX */

	return (ret);
}

function caAggrValueHeatmapCommon(ret, conf)
{
	ret['nbuckets'] = conf['nbuckets'];
	ret['width'] = conf['width'];
	ret['height'] = conf['height'];
}

/*
 * Describes allowable HTTP parameters for heatmap resources.
 */
var caAggrHeatmapParams = {
	height: {
	    type: 'number',
	    default: 300,
	    min: 10,
	    max: 1000
	},
	width: {
	    type: 'number',
	    default: 600,
	    min: 10,
	    max: 1000
	},
	ymin: {
	    type: 'number',
	    default: 0,
	    min: 0,
	    max: 1000000000000		/* 1000s */
	},
	ymax: {
	    type: 'number',
	    default: undefined,		/* auto-scale */
	    min: 0,
	    max: 1000000000000		/* 1000s */
	},
	nbuckets: {
	    type: 'number',
	    default: 100,
	    min: 1,
	    max: 100
	},
	selected: {
	    type: 'array',
	    default: []
	},
	isolate: {
	    type: 'boolean',
	    default: false
	},
	exclude: {
	    type: 'boolean',
	    default: false
	},
	hues: {
	    type: 'array',
	    default: undefined
	},
	weights: {
	    type: 'enum',
	    default: 'weights',
	    choices: { count: true, weight: true }
	},
	coloring: {
	    type: 'enum',
	    default: 'rank',
	    choices: { rank: true, linear: true }
	},
	decompose_all: {
	    type: 'boolean',
	    default: false
	},
	x: {
	    type: 'number',
	    required: true,
	    min: 0
	},
	y: {
	    type: 'number',
	    required: true,
	    min: 0
	},
	percentile: {
	    type: 'float',
	    required: true,
	    min: 0,
	    max: 1
	}
};

function caAggrHeatmapConf(request, start, duration, isolate, nselected)
{
	var conf, formals, actuals, param, max, nhues, hue, hues;
	var ii;

	formals = caAggrHeatmapParams;
	actuals = request.ca_params;
	param = mod_ca.caHttpParam.bind(null, formals, actuals);

	conf = {};
	conf.base = start;
	conf.nsamples = duration;
	conf.height = param('height');
	conf.width = param('width');
	conf.nbuckets = param('nbuckets');
	conf.min = param('ymin');

	if ((max = param('ymax')) !== undefined)
		conf.max = max;

	conf.weighbyrange = param('weights') == 'weight';
	conf.linear = param('coloring') == 'linear';
	hues = param('hues');

	if (conf.min >= conf.max)
		throw (new caValidationError(
		    '"ymax" must be greater than "ymin"'));

	nhues = nselected + (isolate ? 0 : 1);

	if (hues !== undefined) {
		if (nhues > hues.length)
			throw (new caValidationError(
			    'need ' + nhues + ' hues'));

		for (ii = 0; ii < hues.length; ii++) {
			hue = hues[ii] = parseInt(hues[ii], 10);

			if (isNaN(hue) || hue < 0 || hue >= 360)
				throw (new caValidationError('invalid hue'));
		}

		conf.hue = hues;
	}

	return (conf);
}

/*
 * Generate enough hues for "nselected" selected items.  If "isolate" is set,
 * the first hue is omitted (since it will not be used).
 */
function caAggrHeatmapHues(nselected, isolate)
{
	var hues, ii;

	hues = [ 21 ];

	for (ii = 0; ii < nselected; ii++)
		hues.push((hues[hues.length - 1] + 91) % 360);

	if (isolate)
		hues.shift();

	return (hues);
}

exports.caAggrHeatmapHues = caAggrHeatmapHues; /* for testing only */


/*
 * Performs validity checks on the given heatmap request.  Currently we just
 * verify that the instrumentation is of the proper type to support a heatmap.
 */
function caAggrHeatmapCheck(aggrq)
{
	return (caAggrSupportsHeatmap(aggrq.instn()));
}

/*
 * Returns true if the specified instrumentation supports heatmaps.
 */
function caAggrSupportsHeatmap(instn)
{
	return (instn.agi_instrumentation['value-arity'] ===
	    mod_ca.ca_arity_numeric);
}

exports.caAggrSupportsHeatmap = caAggrSupportsHeatmap;

exports.caAggrRawImpl = {
    ai_check: function () { return (true); },
    ai_value: caAggrValueRaw,
    ai_duration: 1
};

exports.caAggrHeatmapImageImpl = {
    ai_check: caAggrHeatmapCheck,
    ai_value: caAggrValueHeatmapImage,
    ai_duration: 60
};

exports.caAggrHeatmapDetailsImpl = {
    ai_check: caAggrHeatmapCheck,
    ai_value: caAggrValueHeatmapDetails,
    ai_duration: 60
};

exports.caAggrHeatmapAverageImpl = {
    ai_check: caAggrHeatmapCheck,
    ai_value: caAggrValueHeatmapAverage,
    ai_duration: 1
};

exports.caAggrHeatmapPercentileImpl = {
    ai_check: caAggrHeatmapCheck,
    ai_value: caAggrValueHeatmapPercentile,
    ai_duration: 1
};
