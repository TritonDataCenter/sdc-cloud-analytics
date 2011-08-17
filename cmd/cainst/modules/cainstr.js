/*
 * cmd/cainst/modules/cainstr.js: instrumenter performance backend
 *
 * This module implements metrics for the instrumenter itself.  This is
 * implemented by listening for events emitted by the instrumenter proper to the
 * backend-interface object provided to each backend.
 */

var mod_assert = require('assert');

var mod_ca = require('../../../lib/ca/ca-common');
var mod_caagg = require('../../../lib/ca/ca-agg');
var mod_instr = require('../../../lib/ca/ca-instr');

var inrBucketizers = {
	latency: mod_instr.caInstrLogLinearBucketize(10, 0, 11, 100),
	subsecond: mod_instr.caInstrLinearBucketize(10)
};

/*
 * Invoked by the instrumenter service to initialize the backend.
 */
exports.insinit = function (instr, log)
{
	var hostname;

	hostname = mod_ca.caSysinfo().ca_hostname;

	instr.registerMetric({
	    module: 'ca',
	    stat: 'instr_ticks',
	    fields: [ 'hostname', 'latency', 'subsecond' ],
	    impl: function (instn) {
		return (new inrMetricImpl(hostname, instr.metadata(),
		    'instr_tick', instn, instr));
	    }
	});

	instr.registerMetric({
	    module: 'ca',
	    stat: 'instr_beops',
	    fields: [ 'hostname', 'cabackend', 'cainstnid',
		'cametric', 'latency', 'subsecond' ],
	    impl: function (instn) {
		return (new inrMetricImpl(hostname, instr.metadata(),
		    'instr_backend_op', instn, instr));
	    }
	});
};

function inrMetricImpl(hostname, metadata, evtname, instn, instr)
{
	var decomps, ii, nnumeric, ndiscrete;

	this.inr_hostname = hostname;
	this.inr_instn = caDeepCopy(instn);
	this.inr_instr = instr;
	this.inr_evtname = evtname;

	decomps = instn.is_decomposition;
	if (decomps.length === 0) {
		this.inr_zero = 0;
		this.inr_add = mod_caagg.caAddScalars;
	} else {
		nnumeric = ndiscrete = 0;

		for (ii = 0; ii < decomps.length; ii++) {
			if (metadata.fieldArity(decomps[ii]) ==
			    mod_ca.ca_field_arity_numeric)
				nnumeric++;
			else
				ndiscrete++;
		}

		if (ndiscrete === 0) {
			this.inr_zero = [];
			this.inr_add = mod_caagg.caAddDistributions;
		} else if (nnumeric === 0) {
			this.inr_zero = {};
			this.inr_add = mod_caagg.caAddDecompositions;
		} else {
			this.inr_zero = {};
			this.inr_add = function (lhs, rhs) {
				return (mod_caagg.caAddDecompositions(lhs, rhs,
				    mod_caagg.caAddDistributions));
			};
		}
	}

	this.inr_value = caDeepCopy(this.inr_zero);
	this.inr_probe = this.receive.bind(this);
}

inrMetricImpl.prototype.instrument = function (callback)
{
	this.inr_instr.addListener(this.inr_evtname, this.inr_probe);
	callback();
};

inrMetricImpl.prototype.deinstrument = function (callback)
{
	this.inr_instr.removeListener(this.inr_evtname, this.inr_probe);
	callback();
};

inrMetricImpl.prototype.value = function (callback)
{
	var value = this.inr_value;
	this.inr_value = caDeepCopy(this.inr_zero);
	callback(value);
};

inrMetricImpl.prototype.receive = function (evt)
{
	var fields, points, newvalue;

	/*
	 * Ignore this event if it doesn't match our predicate.
	 */
	fields = caDeepCopy(evt['fields']);
	fields['hostname'] = this.inr_hostname;
	points = this.inr_instr.applyPredicate(this.inr_instn.is_predicate,
	    [ { fields: fields, value: 1 } ]);

	if (points.length === 0)
		return;

	/*
	 * Combine this data point with whatever value we already have.
	 */
	mod_assert.equal(points.length, 1);
	newvalue = this.inr_instr.computeValue(inrBucketizers,
	    this.inr_instn.is_decomposition, points);
	this.inr_value = this.inr_add(this.inr_value, newvalue);
};
