/*
 * cmd/cainst/modules/fake.js: fake data backend
 *
 * This module provides a synthetic implementation of all available metrics.
 * The implementation reports fake, psuedo-random data.  This is used for
 * testing scalability and UI.  This backend would generally not be used with
 * other backends present, but that should be possible by making sure to load it
 * last so that other backends' implementations are preferred.
 */

var mod_assert = require('assert');

var mod_ca = require('../../../lib/ca/ca-common');
var mod_dist = require('../../../lib/ca/ca-dist');
var mod_instr = require('../../../lib/ca/ca-instr');

/*
 * Invoked by the instrumenter service to initialize the fake metrics.
 */
exports.insinit = function (instr, log)
{
	var metadata, set, metrics, conf;

	conf = {
		inf_npoints: new mod_dist.caDistrNormal(80),
		inf_max_field_values: 10,
		inf_hostname: mod_ca.caSysinfo().ca_hostname,
		inf_bucketizers: {}
	};

	metadata = instr.metadata();
	set = metadata.metricSet();
	metrics = set.baseMetrics();

	/*
	 * Generate a log-linear bucketizer for each of the numeric fields.
	 */
	metrics.forEach(function (metric) {
		metric.fields().forEach(function (field) {
			if (field in conf.inf_bucketizers)
				return;

			if (metadata.fieldArity(field) !=
			    mod_ca.ca_field_arity_numeric)
				return;

			conf.inf_bucketizers[field] =
			    mod_instr.caInstrLogLinearBucketize(10, 0, 11, 100);
		});
	});

	/*
	 * Register an implementation for all possible metrics and fields using
	 * our fake-data implementation.
	 */
	metrics.forEach(function (metric) {
		instr.registerMetric({
		    module: metric.module(),
		    stat: metric.stat(),
		    fields: metric.fields(),
		    impl: function (mm) {
			return (new infMetricImpl(conf, instr, log, metadata,
			    mm, metric));
		    }
		});
	});
};

/*
 * Implementation of the metric interface that generates synthetic data.
 */
function infMetricImpl(conf, instr, log, metadata, instn, metric)
{
	var ii;

	this.ifm_instr = instr;
	this.ifm_log = log;
	this.ifm_metadata = metadata;
	this.ifm_instn = caDeepCopy(instn);
	this.ifm_metric = metric;
	this.ifm_fields = metric.fields();
	this.ifm_bucketizers = conf.inf_bucketizers;
	this.ifm_hostname = conf.inf_hostname;
	this.ifm_npoints = conf.inf_npoints;

	this.ifm_basevalgen = infGenBaseValue(metadata, metric);
	this.ifm_fieldvalgens = {};

	for (ii = 0; ii < this.ifm_fields.length; ii++)
		this.ifm_fieldvalgens[this.ifm_fields[ii]] = infGenFieldValue(
		    conf, metadata, this.ifm_fields[ii]);
}

infMetricImpl.prototype.instrument = function (callback)
{
	this.ifm_log.info('fake backend: instrumenting metric %j',
	    this.ifm_instn);
	callback();
};

infMetricImpl.prototype.deinstrument = function (callback)
{
	callback();
};

infMetricImpl.prototype.value = function (callback)
{
	var impl, npoints, points, point;

	/*
	 * In the constructor we set up a caDistr object for each field plus the
	 * base metric itself.  Here we use those to generate random data
	 * points and then run them through the usual applyPredicate/
	 * computeValue functions to process predicates and decompositions.
	 */
	impl = this;
	npoints = this.ifm_npoints.value();
	points = [];

	while (points.length < npoints) {
		point = {
			fields: {},
			value: this.ifm_basevalgen.value()
		};

		this.ifm_fields.forEach(function (field) {
			point['fields'][field] =
			    impl.ifm_fieldvalgens[field].value();
		});

		points.push(point);
	}

	points = this.ifm_instr.applyPredicate(this.izm_predicate, points);
	return (callback(this.ifm_instr.computeValue(this.ifm_bucketizers,
	    this.ifm_instn.is_decomposition, points)));
};

/*
 * infTypeDists maps metadata type names to a function which returns a
 * distribution appropriate for said type.  This level of indirection allows
 * each distribution object to maintain state for each instance, in turn
 * allowing the data for a particular metric to depend on previous values to
 * produce smoother, more realistic curves.
 */
var infTypeDists = {
	number: function () {
		return (new mod_dist.caDistrNormal(300));
	},
	percent: function () {
		return (new mod_dist.caDistrMemory(0, 100));
	},
	size: function () {
		/* Return a random size between 0 and 10 MB. */
		return (new mod_dist.caDistrMemory(0, 10 * 1024 * 1024));
	},
	time: function () {
		/*
		 * This default "time" distribution return a random time between
		 * 0 and 30ms.  See infFieldValueGenerators below for more
		 * complex distributions used for "latency" and "runtime".
		 */
		return (new mod_dist.caDistrNormal(30 * 1000 * 1000));
	}
};

/*
 * Return a distribution appropriate for the given base metric, based on the
 * metric's type.
 */
function infGenBaseValue(metadata, metric)
{
	var type;

	type = metadata.metricType(metric.module(), metric.stat());
	if (!type || !(type in infTypeDists))
		type = 'number';

	mod_assert.ok(type && type in infTypeDists);

	return (infTypeDists[type]());
}

/*
 * infFieldValueGenerators maps field names to functions that return
 * distributions of values for that field.  If a field has such a function in
 * this table, the distribution it returns will be used to generate synthetic
 * values of this field.  Fields not specified here will have default synthetic
 * values created.  As in infTypeDists above, the values in this table are
 * functions rather than distributions to allow for stateful distributions.
 */
var infFieldValueGenerators = {
	hostname: function (conf) {
		/* Each host always returns the same hostname */
		/* JSSTYLED */
		return ({
		    value: function () { return (conf.inf_hostname); }
		});
	},
	zonename: function (conf) {
		/* Zonenames should be unique across hosts. */
		return (new infStemGenerator(
		    conf.inf_hostname + '_zone', conf.inf_max_field_values));
	},
	latency: function () {
		/*
		 * This latency distribution looks loosely like what you'd
		 * expect for filesystem operations: some are cached and
		 * complete quickly, many require hitting spindles and have
		 * larger, more variable latency, and a few outliers take even
		 * longer than that.
		 */
		return (new mod_dist.caDistrMulti([
		    { pp: 0.6,
			dist: new mod_dist.caDistrUniform(0, 10 * 1000) },
		    { pp: 0.397,
			dist: new mod_dist.caDistrNormal(7 * 1000 * 1000) },
		    { dist: new mod_dist.caDistrNormal(12 * 1000 * 1000) }
		]));
	},
	runtime: function () {
		/*
		 * This distribution tries to capture banding around 10ms, 20ms,
		 * and 30ms, as might be seen with the OS scheduler.
		 */
		return (new mod_dist.caDistrMulti([
		    { pp: 0.02, dist: new mod_dist.caDistrUniform(
			30 * 1000 * 1000, 30.1 * 1000 * 1000) },
		    { pp: 0.1, dist: new mod_dist.caDistrNormal(
			30 * 1000 * 1000) },
		    { pp: 0.06, dist: new mod_dist.caDistrUniform(
			20 * 1000 * 1000, 20.1 * 1000 * 1000) },
		    { pp: 0.2, dist: new mod_dist.caDistrNormal(
			20 * 1000 * 1000) },
		    { pp: 0.15, dist: new mod_dist.caDistrUniform(
			10 * 1000 * 1000, 10.1 * 1000 * 1000) },
		    { dist: new mod_dist.caDistrNormal(
			10 * 1000 * 1000, 0.5) }
		]));
	}
};

/*
 * Return a caDistr appropriate for the given field.
 */
function infGenFieldValue(conf, metadata, field)
{
	var type;

	if (field in infFieldValueGenerators)
		return (infFieldValueGenerators[field](conf));

	type = metadata.fieldType(field);
	if (type in infTypeDists)
		return (infTypeDists[type]());

	mod_assert.equal(metadata.fieldArity(field),
	    mod_ca.ca_field_arity_discrete);
	return (new infStemGenerator(field, conf.inf_max_field_values));
}

/*
 * Like caDistrUniform, but prepends each data value with the stem.
 */
function infStemGenerator(stem, max)
{
	this.isg_stem = stem;
	this.isg_max = max;
}

infStemGenerator.prototype.value = function ()
{
	var sfx = Math.ceil(Math.random() * this.isg_max);
	return (this.isg_stem + sfx);
};
