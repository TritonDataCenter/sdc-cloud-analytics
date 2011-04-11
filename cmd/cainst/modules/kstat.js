/*
 * cmd/cainst/modules/kstat.js: kstat Instrumenter backend
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_kstat = require('kstat');
var mod_ca = require('../../../lib/ca/ca-common');
var mod_capred = require('../../../lib/ca/ca-pred');

var inskLog;
var inskHostname;

/*
 * Invoked by the instrumenter service to initialize the kstat-based metrics.
 */
exports.insinit = function (instr, log)
{
	inskLog = log;
	inskHostname = mod_ca.caSysinfo().ca_hostname;
	inskInitAutoMetrics(instr);
};

/*
 * Registers the metrics defined below with the instrumenter service.
 */
function inskInitAutoMetrics(instr)
{
	var metadata, impl, ii;

	metadata = instr.metadata();
	impl = function (desc) {
		return (function (mm) {
			return (new insKstatAutoMetric(desc, mm, metadata));
		});
	};

	for (ii = 0; ii < inskMetrics.length; ii++) {
		inskLog.dbg('loading kstat metric ' + (ii + 1));

		inskMetrics[ii]['fields']['hostname'] = {
			values: function () { return ([ inskHostname ]); }
		};

		inskAutoMetricValidate(inskMetrics[ii], metadata);

		instr.registerMetric({
			module: inskMetrics[ii]['module'],
			stat: inskMetrics[ii]['stat'],
			fields: Object.keys(inskMetrics[ii]['fields']),
			impl: impl(inskMetrics[ii])
		});
	}
}

/*
 * Validates a metric description of the form used below.
 */
function inskAutoMetricValidate(desc, metadata)
{
	var fieldname, field, arity;

	ASSERT(desc['module'] && typeof (desc['module']) == typeof (''));
	ASSERT(desc['stat'] && typeof (desc['stat']) == typeof (''));
	ASSERT(desc['kstat'] && desc['kstat'].constructor == Object);
	ASSERT(!caIsEmpty(desc['kstat']));
	ASSERT((!('filter' in desc)) || desc['filter'].constructor == Function);
	ASSERT(desc['extract'] && desc['extract'].constructor == Function);
	ASSERT(desc['fields'] && desc['fields'].constructor == Object);

	for (fieldname in desc['fields']) {
		field = desc['fields'][fieldname];
		ASSERT(field.constructor == Object);
		ASSERT((!('values' in field)) ||
		    field['values'].constructor == Function);

		arity = metadata.fieldArity(fieldname);

		if (arity == mod_ca.ca_field_arity_discrete)
			ASSERT(!('bucketize' in field));
		else {
			ASSERT(arity == mod_ca.ca_field_arity_numeric);
			ASSERT(field['bucketize'] &&
			    field['bucketize'].constructor == Function);
		}
	}
}

/*
 * KSTAT METRICS
 *
 * For our purposes, an individual "kstat" is uniquely identified by its module,
 * instance, name, and class.  "class" isn't traditionally part of a kstat's
 * identifier, but it's important for metric definitions to select only the
 * kstats for a particular class.  "statistic" is traditionally part of a
 * kstat's identifier, but we don't need this level of granularity.
 *
 * Each kstat-based metric description defines the following fields:
 *
 *	module, stat	Specifies which metric is being defined
 *
 *	kstat		Specifies a set of kstats to examine when computing the
 *			value of this metric.  This is an object specifying one
 *			or more of "module", "class", or "name".  Only the
 *			kstats matching these fields exactly will be used.
 *
 *	filter		Function applied to each kstat to filter kstats based on
 *	(optional)	criteria not expressible in the "kstat" member.  For
 *			example, this is used to show only 'sd' and 'cmdk'
 *			disks and not 'ramdisk' disks.
 *
 *	fields		Describes fields available for predicates and
 *			decompositions, indexed by field name.  See below.
 *
 *	extract		as extract(fields, kstat, klast, interval): given
 *			a set of values for this metric's fields, a "current"
 *			kstat, a "previous" kstat, and the interval between
 *			them, return the value of the base metric for this data
 *			point.
 *
 * Each field specifies the following members:
 *
 *	values		as values(kstat, klast, interval): List of possible
 *			values of this field in the given kstat.  For static
 *			fields like "optype", this function might always return
 *			a list like [ 'read, 'write' ].  For a field value that
 *			depends on the kstat like 'cpuid', this function might
 *			return something like [ 'cpu' + kstat['instance'] ].
 *
 *	bucketize	as bucketize(dist, value, cardinality): updates
 *	(numeric	distribution "dist" with a new data point at "value".
 *	fields only)	The value at the bucket containing "value" is increased
 *			by "cardinality".
 *
 * See the documentation for value() for information about how these pieces are
 * combined when an actual value is needed.
 *
 *
 * VERSIONING
 *
 * If these things get moved into metadata, be sure to include a "type" (e.g.,
 * kstat) and a version field (reflecting the semantic version of this format).
 */
var inskMetrics = [ {
	module: 'cpu',
	stat: 'cpus',
	kstat: { module: 'cpu', class: 'misc', name: 'sys' },
	extract: inskResourceExtract,
	fields: {
		cpu: {
			values: function (kstat) {
				return ([ 'cpu' + kstat['instance'] ]);
			}
		},
		utilization: {
			bucketize: caMakeLinearBucketize(1),
			values: function (kstat, kprev, interval) {
				var oldd, newd, oldsum, newsum;
				oldd = kprev['data'];
				newd = kstat['data'];
				oldsum = oldd['cpu_nsec_kernel'] +
				    oldd['cpu_nsec_user'];
				newsum = newd['cpu_nsec_kernel'] +
				    newd['cpu_nsec_user'];
				return ([ Math.floor(100 *
				    (newsum - oldsum) / interval) ]);
			}
		}
	}
}, {
	module: 'nic',
	stat: 'nics',
	kstat: { module: 'link', class: 'net' },
	filter: inskNicFilter,
	extract: inskResourceExtract,
	fields: {
		nic: {
			values: function (kstat) {
				return ([ kstat['name'] ]);
			}
		},
		packets: {
			bucketize: caMakeLogLinearBucketize(10, 0, 11, 100),
			values: function (kstat, kprev) {
				var oldd, newd, oldsum, newsum;
				oldd = kprev['data'];
				newd = kstat['data'];
				oldsum = oldd['ipackets64'] +
				    oldd['opackets64'];
				newsum = newd['ipackets64'] +
				    newd['opackets64'];
				return ([ newsum - oldsum ]);
			}
		},
		packets_in: {
			bucketize: caMakeLogLinearBucketize(10, 0, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				return ([newd['ipackets64'] -
				    oldd['ipackets64']]);
			}
		},
		packets_out: {
			bucketize: caMakeLogLinearBucketize(10, 0, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				return ([newd['opackets64'] -
				    oldd['opackets64']]);
			}
		},
		bytes: {
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			values: function (kstat, kprev) {
				var oldd, newd, oldsum, newsum;
				oldd = kprev['data'];
				newd = kstat['data'];
				oldsum = oldd['rbytes64'] + oldd['obytes64'];
				newsum = newd['rbytes64'] + newd['obytes64'];
				return ([ newsum - oldsum ]);
			}
		},
		bytes_read: {
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				return ([newd['rbytes64'] - oldd['rbytes64']]);
			}
		},
		bytes_write: {
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				return ([newd['obytes64'] - oldd['obytes64']]);
			}
		}
	}
}, {
	module: 'nic',
	stat: 'bytes',
	kstat: { module: 'link', class: 'net' },
	filter: inskNicFilter,
	extract: function (fields, kstat, kprev) {
		var newd = kstat['data'];
		var oldd = kprev['data'];
		var key = (fields['direction'] == 'sent') ?
		    'obytes64' : 'rbytes64';
		return (newd[key] - oldd[key]);
	},
	fields: {
		nic: {
			values: function (kstat) {
				return ([ kstat['name'] ]);
			}
		},
		direction: {
			values: function () { return ([ 'sent', 'received' ]); }
		}
	}
}, {
	module: 'nic',
	stat: 'packets',
	kstat: { module: 'link', class: 'net' },
	filter: inskNicFilter,
	extract: function (fields, kstat, kprev) {
		var newd = kstat['data'];
		var oldd = kprev['data'];
		var key = (fields['direction'] == 'sent') ?
		    'opackets64' : 'ipackets64';
		return (newd[key] - oldd[key]);
	},
	fields: {
		nic: {
			values: function (kstat) {
				return ([ kstat['name'] ]);
			}
		},
		direction: {
			values: function () { return ([ 'sent', 'received' ]); }
		}
	}
}, {
	module: 'disk',
	stat: 'disks',
	kstat: { class: 'disk' },
	filter: inskDiskFilter,
	extract: inskResourceExtract,
	fields: {
		disk: {
			values: function (kstat) {
				return ([ kstat['name'] ]);
			}
		},
		iops: {
			bucketize: caMakeLogLinearBucketize(10, 0, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				var newsum = newd['writes'] + newd['reads'];
				var oldsum = oldd['writes'] + oldd['reads'];
				return ([ newsum - oldsum ]);
			}
		},
		iops_read: {
			bucketize: caMakeLogLinearBucketize(10, 0, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				return ([ newd['reads'] - oldd['reads'] ]);
			}
		},
		iops_write: {
			bucketize: caMakeLogLinearBucketize(10, 0, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				return ([ newd['writes'] - oldd['writes'] ]);
			}
		},
		bytes: {
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				var newsum = newd['nwritten'] + newd['nread'];
				var oldsum = oldd['nwritten'] + oldd['nread'];
				return ([ newsum - oldsum ]);
			}
		},
		bytes_read: {
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				return ([ newd['nread'] - oldd['nread'] ]);
			}
		},
		bytes_write: {
			bucketize: caMakeLogLinearBucketize(10, 2, 11, 100),
			values: function (kstat, kprev) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				return ([ newd['nwritten'] -
				    oldd['nwritten'] ]);
			}
		},
		busytime: {
			bucketize: caMakeLinearBucketize(1),
			values: function (kstat, kprev, interval) {
				var newd = kstat['data'];
				var oldd = kprev['data'];
				return ([ Math.floor(100 * (newd['rtime'] -
				    oldd['rtime']) / interval) ]);
			}
		}
	}
}, {
	module: 'disk',
	stat: 'physio_ops',
	kstat: { class: 'disk' },
	filter: inskDiskFilter,
	extract: inskIoExtractOps,
	fields: {
		disk: {
			values: function (kstat) {
				return ([ kstat['name'] ]);
			}
		},
		optype: {
			values: function () { return ([ 'read', 'write' ]); }
		}
	}
}, {
	module: 'disk',
	stat: 'physio_bytes',
	kstat: { class: 'disk' },
	filter: inskDiskFilter,
	extract: inskIoExtractBytes,
	fields: {
		disk: {
			values: function (kstat) {
				return ([ kstat['name'] ]);
			}
		},
		optype: {
			values: function () { return ([ 'read', 'write' ]); }
		}
	}
}, {
	module: 'tcp',
	stat: 'connections',
	kstat: { module: 'tcp', class: 'mib2' },
	extract: inskTcpConnectionsExtract,
	fields: {
		tcpstack: {
			values: function (kstat) {
				return ([ 'tcp' + kstat['instance'] ]);
			}
		},
		conntype: {
			values: function () {
				return ([ 'active', 'passive' ]);
			}
		}
	}
}, {
	module: 'tcp',
	stat: 'segments',
	kstat: { module: 'tcp', class: 'mib2' },
	extract: inskTcpSegmentsExtract,
	fields: {
		tcpstack: {
			values: function (kstat) {
				return ([ 'tcp' + kstat['instance'] ]);
			}
		},
		direction: {
			values: function () {
				return ([ 'sent', 'received' ]);
			}
		}
	}
}, {
	module: 'tcp',
	stat: 'errors',
	kstat: { module: 'tcp', class: 'mib2' },
	extract: inskTcpErrorExtract,
	fields: {
		tcpstack: {
			values: function (kstat) {
				return ([ 'tcp' + kstat['instance'] ]);
			}
		},
		errtype: {
			values: inskTcpErrtypeValues
		}
	}
}, {
	module: 'fs',
	stat: 'logical_rwops',
	kstat: { module: 'zone_vfs' },
	extract: inskIoExtractOps,
	fields: {
		zonename: {
			values: function (kstat) {
				return ([ kstat['name'] ]);
			}
		},
		optype: {
			values: function () { return ([ 'read', 'write' ]); }
		}
	}
}, {
	module: 'fs',
	stat: 'logical_rwbytes',
	kstat: { module: 'zone_vfs' },
	extract: inskIoExtractBytes,
	fields: {
		zonename: {
			values: function (kstat) {
				return ([ kstat['name'] ]);
			}
		},
		optype: {
			values: function () { return ([ 'read', 'write' ]); }
		}
	}
} ];

function inskNicFilter(kstat)
{
	/*
	 * The "link" module includes the links visible inside the zone in which
	 * we're running.  On a COAL headnode GZ, this includes the "physical"
	 * links (e1000g{0,1}), the VMware bridge (vmwarebr0), and the VNICs
	 * inside each zone (as z{zoneid}_{identifier}0.  Inside a provisioned
	 * zone, this is just "net0".  Currently we only want to include
	 * hardware NICs here, but for testing it's convenient to include "net0"
	 * as well, which should be fine because it will never show up in the
	 * global zone where we run in production.
	 */
	return (/^(e1000g|bnx|net)\d+$/.test(kstat['name']));
}

function inskDiskFilter(kstat)
{
	return (kstat['module'] == 'cmdk' || kstat['module'] == 'sd');
}

function inskIoExtractOps(fields, kstat, kprev)
{
	var key = (fields['optype'] == 'read') ? 'reads' : 'writes';
	return (kstat['data'][key] - kprev['data'][key]);
}

function inskIoExtractBytes(fields, kstat, klast)
{
	var key = (fields['optype'] == 'read') ? 'nread' : 'nwritten';
	return (kstat['data'][key] - klast['data'][key]);
}

/*
 * "Resource" metrics return "1" for each kstat, since they're just counting up
 * the instances of a resource.
 */
function inskResourceExtract()
{
	return (1);
}

function inskTcpConnectionsExtract(fields, kstat, kprev)
{
	var conntype, kstatkey;

	conntype = fields['conntype'];
	kstatkey = conntype + 'Opens';
	return (kstat['data'][kstatkey] - kprev['data'][kstatkey]);
}

function inskTcpSegmentsExtract(fields, kstat, kprev)
{
	var direction, kstatkey;

	direction = fields['direction'];
	kstatkey = direction == 'sent' ? 'outSegs' : 'inSegs';
	return (kstat['data'][kstatkey] - kprev['data'][kstatkey]);
}

var inskTcpErrors = {
	'attemptFails': 'failed connection attempt',
	'retransSegs': 'retransmitted segment',
	'inDupAck': 'duplicate ACK',
	'listenDrop': 'connection refused because backlog full',
	'listenDropQ0': 'connection refused from full half-open queue',
	'halfOpenDrop': 'connection dropped from a full half-open queue',
	'timRetransDrop': 'connection dropped due to retransmit timeout'
};

function inskTcpErrorExtract(fields, kstat, kprev)
{
	var errtype, kstatkey;

	errtype = fields['errtype'];

	for (kstatkey in inskTcpErrors) {
		if (inskTcpErrors[kstatkey] == errtype)
			break;
	}

	ASSERT(typeof (kstat['data'][kstatkey]) == 'number');
	return (kstat['data'][kstatkey] - kprev['data'][kstatkey]);
}

function inskTcpErrtypeValues(kstat, kprev)
{
	return (Object.keys(inskTcpErrors).map(function (elt) {
		return (inskTcpErrors[elt]);
	}));
}

/*
 * Implements the instrumenter's Metric interface for the kstat-based metric
 * desribed by "desc" and the actual instrumentation request described by
 * "metric".
 */
function insKstatAutoMetric(desc, metric, metadata)
{
	var field, arity, ndiscrete, nnumeric, ii;

	this.iam_kstat = caDeepCopy(desc.kstat);
	this.iam_fields = caDeepCopy(desc.fields);
	this.iam_filter = desc.filter;
	this.iam_extract = desc.extract;
	this.iam_metric = caDeepCopy(metric);
	this.iam_reader = new mod_kstat.Reader(this.iam_kstat);
	this.iam_last = null;
	this.iam_decompositions = [];
	this.iam_metadata = metadata;

	/*
	 * Discrete decompositions must come first, and there can be at most one
	 * numeric decomposition, but we do support more than one discrete
	 * decomposition.
	 */
	ndiscrete = nnumeric = 0;
	for (ii = 0; ii < metric.is_decomposition.length; ii++) {
		field = metric.is_decomposition[ii];
		ASSERT(field in desc['fields']);
		arity = metadata.fieldArity(field);

		if (arity == mod_ca.ca_field_arity_discrete) {
			this.iam_decompositions.unshift(field);
			ndiscrete++;
		} else {
			this.iam_decompositions.push(field);
			nnumeric++;
		}
	}

	ASSERT(nnumeric <= 1);

	if (ndiscrete > 0)
		this.iam_zero = {};
	else if (nnumeric > 0)
		this.iam_zero = [];
	else
		this.iam_zero = 0;

	/*
	 * For kstats, instrumenting particular zones is only possible for
	 * metrics which provide a "zonename" field.  All we need do is add a
	 * predicate that selects these zonenames.
	 */
	if (metric.is_zones) {
		this.iam_predicate = {
		    and: [
			{ or: metric.is_zones.map(function (zone) {
				return ({ eq: [ 'zonename', zone ] });
				}) },
			metric.is_predicate
		    ]
		};
	} else {
		this.iam_predicate = metric.is_predicate;
	}
}

exports.insKstatAutoMetric = insKstatAutoMetric; /* for testing */

insKstatAutoMetric.prototype.instrument = function (callback)
{
	if (inskLog)
		inskLog.info('kstat: %j\ndecomps: %j\npredicate: %j',
		    this.iam_kstat, this.iam_decompositions,
		    this.iam_predicate);
	callback();
};

insKstatAutoMetric.prototype.deinstrument = function (callback) { callback(); };

/*
 * Retrieve the latest kstat data and convert it to an object indexed by kstat
 * identifier rather than by arbitrary integer index.  We do this because we
 * need to be able to match up kstats from different snapshots (i.e. the current
 * kstat with its "previous" kstat) but the indices can change across different
 * calls to read() if the underlying kstat chain has been updated.  We also
 * filter out any kstats here that we don't care about.  This function is
 * factored out primarily for the test suite to override it.
 */
insKstatAutoMetric.prototype.read = function ()
{
	var kraw, kdata, key, ii;

	kraw = this.iam_reader.read();
	kdata = {};

	for (ii = 0; ii < kraw.length; ii++) {
		if (this.iam_filter && !(this.iam_filter(kraw[ii])))
			continue;

		key = [ kraw[ii]['module'], kraw[ii]['instance'],
		    kraw[ii]['class'], kraw[ii]['name'] ].join(':');
		kdata[key] = kraw[ii];
	}

	return (kdata);
};

/*
 * Given a list of data points, return a new list comprised of those which match
 * the predicate.  This is factored out for use in the test suite.
 */
insKstatAutoMetric.prototype.applyPredicate = function (datapts)
{
	var predicate = this.iam_predicate;

	return (datapts.filter(function (elt) {
		return (mod_capred.caPredEval(predicate, elt['fields']));
	}));
};

/*
 * When the value for a kstat-based metric is needed, the framework does the
 * following:
 *
 *	(1) Use read() to get the current values of each kstat matching the
 *	    metric description's "kstat" field.  This process invokes the
 *	    metric's "filter" function on each kstat and removes those for which
 *	    the filter returns false.
 *
 *	(2) Save this set of kstats for computing deltas in the future.  If this
 *	    is the first time through value(), we just return zero here since
 *	    most kstats do require a pair of snapshots for a delta.
 *
 *	(3) Convert the list of kstats into a list of data points, which are
 *	    expressed in terms of this metric's fields.  Each data point denotes
 *	    some value of the base metric (e.g., "100 total I/O operations")
 *	    corresponding to a particular set of values for each of the metric's
 *	    "fields" (e.g., { disk: 'sd0', optype: "read" }).  This is
 *	    constructed by iterating each field, invoking the "value" function
 *	    for the field, and combining this with the result of doing this for
 *	    all fields.  For each of these values, we invoke the metric's
 *	    "extract" function to get the base metric value for these fields.
 *	    The "value" and "extract" functions both get the current kstat, the
 *	    previous kstat, and the interval so that they can report a delta or
 *	    a value over time.
 *
 *	(6) Invoke caEvalPred with the instrumentation's predicate on each of
 *	    the data points and remove those for which the predicate is false.
 *
 *	(7) "Sum" the resulting values according to the instrumentation's
 *	    specified decompositions.
 *
 *	    (a) If no decompositions were specified, just sum all of the values.
 *
 *	    (b) If a discrete decomposition was specified, sum the values
 *	        (recursively) for each value of the decomposition field.  The
 *	        recursion handles subsequent discrete and numeric
 *	        decompositions.
 *
 *	    (c) If a numeric decomposition was specified, bucketize the values
 *	        according to the "bucketize" function specified for this field.
 */
insKstatAutoMetric.prototype.value = function ()
{
	var kdata, klast, datapts, interval, key;

	kdata = this.read();

	/*
	 * We save the first data point but return zero for its value because we
	 * don't have meaningful per-second data without a delta.
	 */
	klast = this.iam_last;
	this.iam_last = kdata;

	if (klast === null)
		return (caDeepCopy(this.iam_zero));

	datapts = [];
	for (key in kdata) {
		/*
		 * Similarly, wait until we've accumulated two snapshots so that
		 * all metrics can assume a delta is available.
		 */
		if (!(key in klast))
			continue;

		interval = kdata[key]['snaptime'] - klast[key]['snaptime'];
		datapts.push.apply(datapts,
		    this.kstatDataPoints(kdata[key], klast[key], interval));
	}

	datapts = this.applyPredicate(datapts);

	/*
	 * Compute the actual value based on the decompositions.
	 */
	return (this.addDecompositions(datapts, this.iam_decompositions, 0));
};

/*
 * Given a set of datapoints and decompositions, compute the value.
 */
insKstatAutoMetric.prototype.addDecompositions = function (datapts, decomps, ii)
{
	var field, arity, rv, key, fieldvalues, subdata, jj;

	/*
	 * Simple case: scalar values.  Just add them up.
	 */
	if (ii >= decomps.length) {
		return (datapts.reduce(function (sum, elt) {
			return (sum + elt['value']);
		}, 0));
	}

	field = this.iam_fields[decomps[ii]];
	arity = this.iam_metadata.fieldArity(decomps[ii]);

	if (arity == mod_ca.ca_field_arity_numeric) {
		/* numeric decompositions must be last */
		ASSERT(ii == decomps.length - 1);
		rv = [];
		for (jj = 0; jj < datapts.length; jj++) {
			field['bucketize'](rv,
			    datapts[jj]['fields'][decomps[ii]],
			    datapts[jj]['value']);
		}

		return (rv);
	}

	ASSERT(arity == mod_ca.ca_field_arity_discrete);
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

		rv[key] = this.addDecompositions(subdata, decomps, ii + 1);
	}

	return (rv);
};

/*
 * Given two kstats over a given interval of time, return an array of data
 * points.  Each data point contains two members:
 *
 *	fields		An object mapping field name to a particular value of
 *			this field based on the kstat.  For example:
 *
 *			    { disk: 'sd0', hostname: 'ca', optype: 'read' }
 *
 *	value		The value of the base metric for the specified set of
 *			fields.  For the above example, the metric could be
 *			Disk Physical IOPS and the value might be 100,
 *			indicating 100 IOPs occurred of type "read" for disk sd0
 *			on hostname "ca".
 *
 * In many cases, there will be one such data point for a single kstat.  This
 * function will return multiple values in cases where a given kstat corresponds
 * to multiple distinct sets of values.  For example, the disk operations metric
 * uses one kstat per disk, but gets multiple values of the "optype" field per
 * kstat.  So this function will return two data points differing in the "value"
 * field and the value of the "optype" field in "fields".
 *
 * This algorithm is technically O(N^M), where N is the number of distinct
 * values any field can have simultaneously in a single kstat and M is the
 * number of different fields.  But N is always a fixed constant (some subset of
 * the total number of discrete statistics in the kstat) and we only generate as
 * many tuples as actually exist.
 */
insKstatAutoMetric.prototype.kstatDataPoints = function (kstat, klast, interval)
{
	var rv, fields, ii;

	rv = [];
	fields = Object.keys(this.iam_fields);
	ASSERT(fields.length > 0); /* everything supports hostname */
	this.kstatDataPointsFrom(rv, kstat, klast, interval, fields, 0);

	for (ii = 0; ii < rv.length; ii++) {
		rv[ii] = {
		    fields: rv[ii],
		    value: this.iam_extract(rv[ii], kstat, klast, interval)
		};
	}

	return (rv);
};

insKstatAutoMetric.prototype.kstatDataPointsFrom = function (rv, kstat, klast,
    interval, fields, ii)
{
	var fieldname, fieldinfo, fieldvalues, dpfields, extra;
	var jj, kk;

	/*
	 * Compute the possible values of this field from the current kstat.
	 */
	ASSERT(rv.length === 0);
	ASSERT(ii < fields.length);
	fieldname = fields[ii];
	fieldinfo = this.iam_fields[fieldname];
	if (fieldinfo['values'])
		fieldvalues = fieldinfo['values'](kstat, klast, interval);
	else
		fieldvalues = [ fieldname ];
	ASSERT(fieldvalues instanceof Array);
	ASSERT(fieldvalues.length > 0);

	/*
	 * Base case: if we're processing the last field, then the result is
	 * simply a set of single-key objects for each value of this field.
	 */
	if (ii == fields.length - 1) {
		for (jj = 0; jj < fieldvalues.length; jj++) {
			dpfields = {};
			dpfields[fieldname] = fieldvalues[jj];
			rv.push(dpfields);
		}

		return;
	}

	/*
	 * Recursive case: there are more fields to process.  We first process
	 * those remaining fields and then combine the possible values of this
	 * field with the data points from the recursive case.  We try to avoid
	 * copying unnecessarily since in most cases we only have 1 value to add
	 * and no copy is needed.
	 */
	extra = [];
	this.kstatDataPointsFrom(rv, kstat, klast, interval, fields, ii + 1);
	ASSERT(rv.length > 0);
	for (jj = 0; jj < rv.length; jj++) {
		rv[jj][fieldname] = fieldvalues[0];

		for (kk = 1; kk < fieldvalues.length; kk++) {
			dpfields = caDeepCopy(rv[jj]);
			dpfields[fieldname] = fieldvalues[kk];
			extra.push(dpfields);
		}
	}

	while (extra.length > 0)
		rv.push(extra.pop());
};

function caMakeLinearBucketize(step)
{
	return (function (rv, value, card) {
		return (caLinearBucketize(rv, value, card, step));
	});
}

exports.caMakeLinearBucketize = caMakeLinearBucketize;

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

	ASSERT(ii == rv.length || value < rv[ii][0][0]);
	ASSERT(ii === 0 || value > rv[ii - 1][0][1]);

	ent = [ [ 0, 0 ], card ];
	ent[0][0] = Math.floor(value / step) * step;
	ent[0][1] = ent[0][0] + step - 1;
	rv.splice(ii, 0, ent);
	return (rv);
}

function caMakeLogLinearBucketize(base, min, max, nbuckets)
{
	return (function (rv, value, card) {
		return (caLogLinearBucketize(rv, value, card, base, min, max,
		    nbuckets));
	});
}

exports.caMakeLogLinearBucketize = caMakeLogLinearBucketize;

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

	ASSERT(ii == rv.length || value < rv[ii][0][0]);
	ASSERT(ii === 0 || value > rv[ii - 1][0][1]);

	ent = [ [ 0, 0 ], card ];

	if (value < Math.pow(base, min)) {
		ent[0][0] = 0;
		ent[0][1] = Math.pow(base, min);
	} else {
		logbase = Math.floor(Math.log(value) / Math.log(base));
		step = Math.pow(base, logbase + 1) / nbuckets;
		offset = value - Math.pow(base, logbase);

		ent[0][0] = Math.pow(base, logbase) +
		    (Math.floor(offset / step) * step);
		ent[0][1] = ent[0][0] + step - (step / base);
	}

	rv.splice(ii, 0, ent);
	return (rv);
}
