/*
 * cmd/cainst/modules/kstat.js: kstat Instrumenter backend
 */

var ASSERT = require('assert');

var mod_kstat = require('kstat');
var mod_ca = require('../../../lib/ca/ca-common');
var mod_capred = require('../../../lib/ca/ca-pred');

var inskLog;
var inskMetrics;
var inskHostname = mod_ca.caSysinfo().ca_hostname;

exports.insinit = function (ins, log)
{
	inskLog = log;
	ins.registerModule({ name: 'cpu', label: 'CPU' });
	ins.registerModule({ name: 'disk', label: 'Disk I/O' });
	ins.registerModule({ name: 'nic', label: 'Network interfaces' });
	inskInitAutoMetrics(ins);
};

/*
 * If these things get moved into metadata, be sure to include a "type" (e.g.,
 * kstat) and a version field (reflecting the semantic version of this format).
 */
inskMetrics = [ {
	module: 'cpu',
	stat: 'cpus',
	label: 'CPUs',
	type: 'size',
	kstat: { module: 'cpu', class: 'misc', name: 'sys' },
	sumfields: [ 'cpu' ],
	fields: {
		cpu: {
			label: 'CPU identifier',
			type: mod_ca.ca_type_string,
			map: function () { return (1); },
			combine: function (oldvalue, newvalue) {
				return (newvalue);
			},
			fieldvalues: [ 'cpu$instance' ]
		},
		hostname: {
			label: 'hostname',
			type: mod_ca.ca_type_string,
			map: function () { return (1); },
			combine: function (oldvalue, newvalue) {
				return (newvalue);
			},
			fieldvalues: [ inskHostname ]
		},
		utilization: {
			label: 'utilization',
			type: mod_ca.ca_type_number,
			bucketize: caMakeLinearBucketize(1),
			map: function (data) {
				return (data['cpu_nsec_kernel'] +
				    data['cpu_nsec_user']);
			},
			combine: function (oldvalue, newvalue, interval) {
				return (Math.floor(100 *
				    (newvalue - oldvalue) / interval));
			}
		}
	}
}, {
	module: 'nic',
	stat: 'nics',
	label: 'NICs',
	type: 'size',
	kstat: { module: 'link', class: 'net' },
	filter: function (kstat) {
		/*
		 * The "link" module includes the links visible inside the zone
		 * in which we're running.  On a COAL headnode GZ, this includes
		 * the "physical" links (e1000g{0,1}), the VMware bridge
		 * (vmwarebr0), and the VNICs inside each zone (as
		 * z{zoneid}_{identifier}0.  Inside a provisioned zone, this is
		 * just "net0".  Currently we only want to include hardware NICs
		 * here, but for testing it's convenient to include "net0" as
		 * well, which should be fine because it will never show up in
		 * the global zone where we run in production.
		 */
		return (/^(e1000g|bnx|net)\d+$/.test(kstat['name']));
	},
	sumfields: [ 'nic' ],
	fields: {
		hostname: {
			label: 'hostname',
			type: mod_ca.ca_type_string,
			map: function () { return (1); },
			combine: function (oldvalue, newvalue) {
				return (newvalue);
			},
			fieldvalues: [ inskHostname ]
		},
		nic: {
			label: 'NIC name',
			type: mod_ca.ca_type_string,
			map: function () { return (1); },
			combine: function (oldvalue, newvalue) {
				return (newvalue);
			},
			fieldvalues: [ '$name' ]
		},
		throughput: {
			label: 'total throughput',
			type: mod_ca.ca_type_number,
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			map: function (data) {
				return (data['rbytes64'] + data['obytes64']);
			},
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			}
		},
		in_throughput: {
			label: 'inbound throughput',
			type: mod_ca.ca_type_number,
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			map: function (data) { return (data['rbytes64']); },
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			}
		},
		out_throughput: {
			label: 'outbound throughput',
			type: mod_ca.ca_type_number,
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			map: function (data) { return (data['obytes64']); },
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			}
		}
	}
}, {
	module: 'disk',
	stat: 'disks',
	label: 'disks',
	type: 'size',
	kstat: { class: 'disk' },
	filter: function (kstat) {
		return (kstat['module'] == 'cmdk' || kstat['module'] == 'sd');
	},
	sumfields: [ 'disk' ],
	fields: {
		hostname: {
			label: 'hostname',
			type: mod_ca.ca_type_string,
			map: function (data) { return (1); },
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue);
			},
			fieldvalues: [ inskHostname ]
		},
		disk: {
			label: 'device name',
			type: mod_ca.ca_type_string,
			fieldvalues: [ '$name' ],
			map: function (data) { return (1); },
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue);
			}
		},
		iops: {
			label: 'number of I/O operations',
			type: mod_ca.ca_type_number,
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			map: function (data) {
				return (data['reads'] + data['writes']);
			},
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			}
		},
		bytes: {
			label: 'total bytes transferred',
			type: mod_ca.ca_type_number,
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			map: function (data) {
				return (data['nread'] + data['nwritten']);
			},
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			}
		},
		bytes_read: {
			label: 'bytes read',
			type: mod_ca.ca_type_number,
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			map: function (data) {
				return (data['nread']);
			},
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			}
		},
		bytes_written: {
			label: 'bytes written',
			type: mod_ca.ca_type_number,
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			map: function (data) {
				return (data['nwritten']);
			},
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			}
		}
	}
}, {
	module: 'disk',
	stat: 'physio_ops',
	label: 'operations',
	type: 'ops',
	kstat: { class: 'disk' },
	filter: function (kstat) {
		return (kstat['module'] == 'cmdk' || kstat['module'] == 'sd');
	},
	sumfields: [ 'disk' ],
	fields: {
		hostname: {
			label: 'hostname',
			type: mod_ca.ca_type_string,
			map: function (data) {
				return (data['reads'] + data['writes']);
			},
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			},
			fieldvalues: [ inskHostname ]
		},
		optype: {
			label: 'type',
			type: mod_ca.ca_type_string,
			fieldvalues: [ 'read', 'write' ],
			map: function (data, value) {
				return (data[value == 'read' ?
				    'reads' : 'writes' ]);
			},
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			}
		},
		disk: {
			label: 'device name',
			type: mod_ca.ca_type_string,
			fieldvalues: [ '$name' ],
			map: function (data) {
				return (data['reads'] + data['writes']);
			},
			combine: function (oldvalue, newvalue, interval) {
				return (newvalue - oldvalue);
			}
		}
	}
} ];

function inskInitAutoMetrics(ins)
{
	var metric, ii, fields, field;

	metric = function (desc) {
		return (function (mm) {
			return (new insKstatAutoMetric(desc, mm));
		});
	};

	for (ii = 0; ii < inskMetrics.length; ii++) {
		fields = {};

		for (field in inskMetrics[ii]['fields']) {
			fields[field] = {
			    type: inskMetrics[ii]['fields'][field]['type'],
			    label: inskMetrics[ii]['fields'][field]['label']
			};
		}

		ins.registerMetric({
			nopredicates: true,
			module: inskMetrics[ii]['module'],
			stat: inskMetrics[ii]['stat'],
			label: inskMetrics[ii]['label'],
			type: inskMetrics[ii]['type'],
			fields: fields,
			metric: metric(inskMetrics[ii])
		});
	}
}

/*
 * Implements the instrumenter Metric interface for the kstat-based metric
 * desribed by "desc" and the actual instrumentation request described by
 * "metric".
 */
function insKstatAutoMetric(desc, metric)
{
	var field, ndiscrete, nnumeric, ii;

	this.iam_kstat = caDeepCopy(desc.kstat);
	this.iam_fields = caDeepCopy(desc.fields);
	this.iam_sumfields = caDeepCopy(desc.sumfields);
	this.iam_filter = desc.filter;
	this.iam_metric = caDeepCopy(metric);
	this.iam_reader = new mod_kstat.Reader(this.iam_kstat);
	this.iam_last = null;

	/*
	 * We do not yet support predicates using kstats.
	 */
	ASSERT.ok(!mod_capred.caPredNonTrivial(metric.is_predicate));

	/*
	 * Like much of the rest of CA, we only support at most one discrete and
	 * at most one numeric decomposition at a time.
	 */
	ndiscrete = nnumeric = 0;
	for (ii = 0; ii < metric.is_decomposition.length; ii++) {
		field = metric.is_decomposition[ii];

		ASSERT.ok(field in desc['fields']);

		if (desc['fields'][field]['type'] == mod_ca.ca_type_string)
			ndiscrete++;
		else
			nnumeric++;
	}

	ASSERT.ok(ndiscrete <= 1);
	ASSERT.ok(nnumeric <= 1);

	if (ndiscrete > 0)
		this.iam_zero = {};
	else if (nnumeric > 0)
		this.iam_zero = [];
	else
		this.iam_zero = 0;
}

insKstatAutoMetric.prototype.instrument = function (callback) { callback(); };
insKstatAutoMetric.prototype.deinstrument = function (callback) { callback(); };

insKstatAutoMetric.prototype.value = function ()
{
	var kraw, key, kdata, klast, rv, field, ii, decomps, numeric, discrete;

	/*
	 * Retrieve the latest kstat data and convert it to an object indexed by
	 * kstat identifier rather than arbitrary index, since the indices can
	 * change across different calls to read() if the underlying kstat chain
	 * has been updated.  We also filter out any kstats we don't care about.
	 */
	kraw = this.iam_reader.read();
	kdata = {};

	for (ii = 0; ii < kraw.length; ii++) {
		if (this.iam_filter && !(this.iam_filter(kraw[ii])))
			continue;

		key = [ kraw[ii]['module'], kraw[ii]['instance'],
		    kraw[ii]['class'], kraw[ii]['name'] ].join(':');
		kdata[key] = kraw[ii];
	}

	/*
	 * We save the first data point but return zero for its value because we
	 * don't have meaningful per-second data without a delta.
	 */
	klast = this.iam_last;
	this.iam_last = kdata;

	if (klast === null)
		return (caDeepCopy(this.iam_zero));

	/*
	 * kstat decompositions work counter-intuitively.  An individual metric
	 * is generally the sum of several different kstats, and the available
	 * decompositions depend on the structure of the underlying stats.  For
	 * example, for the "disk IOPS" metric, the decomposition by "disk" is
	 * made possible only because the underlying kstats are per-disk to
	 * begin with.  So to construct a particular value, what actually
	 * iterate the user-specified decompositions and add the values for each
	 * decomposition that was _not_ specified.
	 */
	decomps = this.iam_metric.is_decomposition;
	ASSERT.ok(decomps.length <= 2);
	if (decomps.length === 0) {
		rv = 0;

		for (ii = 0; ii < this.iam_sumfields.length; ii++) {
			field = this.iam_sumfields[ii];
			rv = this.addScalarValues(rv, klast, kdata, field);
		}

		return (rv);
	}

	for (ii = 0; ii < decomps.length; ii++) {
		ASSERT.ok(decomps[ii] in this.iam_fields);
		field = this.iam_fields[decomps[ii]];

		if (mod_ca.caTypeToArity(field['type']) ==
		    mod_ca.ca_field_arity_discrete)
			discrete = decomps[ii];
		else
			numeric = decomps[ii];
	}

	if (discrete && !numeric) {
		rv = {};
		return (this.addKeys(rv, klast, kdata, discrete));
	}

	if (numeric && !discrete) {
		rv = [];
		return (this.addDist(rv, klast, kdata, numeric));
	}

	ASSERT.ok(numeric && discrete);
	rv = {};
	return (this.addKeyDist(rv, klast, kdata, discrete, numeric));
};

/*
 * Iterate the kstats in "kdata" that are also present in "klast".  For each
 * one, compute the interval between snapshots and invoke "ondata" with the old
 * kstat, the new kstat, and the interval.
 */
insKstatAutoMetric.prototype.gatherData = function (klast, kdata, ondata)
{
	var key, interval;

	ASSERT.ok(klast !== null);

	for (key in kdata) {
		if (!(key in klast))
			continue;

		interval = kdata[key]['snaptime'] - klast[key]['snaptime'];
		ondata(klast[key], kdata[key], interval);
	}
};

insKstatAutoMetric.prototype.addScalarValues = function (rv,
    klast, kdata, fieldname)
{
	var map, combine;

	map = this.iam_fields[fieldname]['map'];
	combine = this.iam_fields[fieldname]['combine'];

	this.gatherData(klast, kdata, function (kprev, kcurr, interval) {
		rv += combine(map(kprev['data']), map(kcurr['data']),
		    interval);
	});

	return (rv);
};

insKstatAutoMetric.prototype.addKeys = function (rv, klast, kdata, fieldname)
{
	var field, map, combine, fieldvalues;

	field = this.iam_fields[fieldname];
	map = field['map'];
	combine = field['combine'];
	fieldvalues = field['fieldvalues'] || [ fieldname ];

	this.gatherData(klast, kdata, function (kprev, kcurr, interval) {
		var keyname, ii;

		for (ii = 0; ii < fieldvalues.length; ii++) {
			keyname = caSubstitute(fieldvalues[ii],
			    caSubObject(kcurr));

			if (!(keyname in rv))
				rv[keyname] = 0;

			rv[keyname] += combine(
			    map(kprev['data'], keyname),
			    map(kcurr['data'], keyname),
			    interval);
		}
	});

	return (rv);
};

insKstatAutoMetric.prototype.addDist = function (rv, klast, kdata, fieldname)
{
	var field, map, combine, bucketize;

	field = this.iam_fields[fieldname];
	map = field['map'];
	combine = field['combine'];
	bucketize = field['bucketize'];

	this.gatherData(klast, kdata, function (kprev, kcurr, interval) {
		var value;

		value = combine(map(kprev['data']), map(kcurr['data']),
		    interval);
		bucketize(rv, value);
	});

	return (rv);
};

insKstatAutoMetric.prototype.addKeyDist = function (rv, klast, kdata,
    discrete, numeric)
{
	var field, map, combine, bucketize, fieldvalues;

	field = this.iam_fields[numeric];
	map = field['map'];
	combine = field['combine'];
	bucketize = field['bucketize'];
	fieldvalues = this.iam_fields[discrete]['fieldvalues'] || [ discrete ];

	this.gatherData(klast, kdata, function (kprev, kcurr, interval) {
		var keyname, ii, value;

		for (ii = 0; ii < fieldvalues.length; ii++) {
			keyname = caSubstitute(fieldvalues[ii],
			    caSubObject(kcurr));

			if (!(keyname in rv))
				rv[keyname] = [];

			value = combine(map(kprev['data']), map(kcurr['data']),
			    interval);
			bucketize(rv[keyname], value);
		}
	});

	return (rv);
};

function caMakeLinearBucketize(step)
{
	return (function (rv, value) {
		return (caLinearBucketize(rv, value, step));
	});
}

function caLinearBucketize(rv, value, step)
{
	var ii, ent;

	for (ii = 0; ii < rv.length; ii++) {
		if (value >= rv[ii][0][0] && value <= rv[ii][0][1]) {
			rv[ii][1]++;
			return;
		}

		if (value < rv[ii][0][0])
			break;
	}

	ASSERT.ok(ii == rv.length || value < rv[ii][0][0]);
	ASSERT.ok(ii === 0 || value > rv[ii - 1][0][1]);

	ent = [ [ 0, 0 ], 1 ];
	ent[0][0] = Math.floor(value / step) * step;
	ent[0][1] = ent[0][0] + step - 1;
	rv.splice(ii, 0, ent);
	return (rv);
}

function caMakeLogLinearBucketize(base, min, max, nbuckets)
{
	return (function (rv, value) {
		return (caLogLinearBucketize(rv, value, base, min, max,
		    nbuckets));
	});
}

function caLogLinearBucketize(rv, value, base, min, max, nbuckets)
{
	var ii, ent, logbase, step, offset;

	for (ii = 0; ii < rv.length; ii++) {
		if (value >= rv[ii][0][0] && value <= rv[ii][0][1]) {
			rv[ii][1]++;
			return;
		}

		if (value < rv[ii][0][0])
			break;
	}

	ASSERT.ok(ii == rv.length || value < rv[ii][0][0]);
	ASSERT.ok(ii === 0 || value > rv[ii - 1][0][1]);

	ent = [ [ 0, 0 ], 1 ];

	if (value < Math.pow(base, min)) {
		ent[0][0] = 0;
		ent[0][1] = Math.pow(base, min);
	} else {
		logbase = Math.floor(Math.log(value) / Math.log(base));
		step = Math.pow(base, logbase + 1) / nbuckets;
		offset = value - Math.pow(base, logbase);

		ent[0][0] = Math.pow(base, logbase) +
		    (Math.floor(offset / step) * step);
		ent[0][1] = ent[0][0] + step - 1;
	}

	rv.splice(ii, 0, ent);
	return (rv);
}
