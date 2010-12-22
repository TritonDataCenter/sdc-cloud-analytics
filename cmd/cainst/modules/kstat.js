/*
 * cmd/cainst/modules/kstat.js: kstat Instrumenter backend
 */

var ASSERT = require('assert');

var mod_kstat = require('kstat');

var mod_ca = require('../../../lib/ca/ca-common');

var inskHostname;

exports.insinit = function (ins)
{
	ins.registerModule({ name: 'cpu', label: 'CPU' });
	ins.registerMetric({
	    module: 'cpu',
	    stat: 'utilization',
	    label: 'utilization',
	    type: 'percent',
	    fields: [],
	    metric: inskMetric
	});

	ins.registerModule({ name: 'io', label: 'Disk I/O' });
	ins.registerMetric({
	    module: 'io',
	    stat: 'bytes',
	    label: 'bytes read/written',
	    type: 'size',
	    fields: {
		hostname: { label: 'hostname', type: 'string' }
	    },
	    metric: inskMetric
	});
	ins.registerMetric({
	    module: 'io',
	    stat: 'ops',
	    label: 'operations',
	    type: 'ops',
	    fields: {
		hostname: { label: 'hostname', type: 'string' }
	    },
	    metric: inskMetric
	});

	ins.registerModule({ name: 'nic', label: 'Network interfaces' });
	ins.registerMetric({
	    module: 'nic',
	    stat: 'bytes',
	    label: 'bytes sent/received',
	    type: 'size',
	    fields: {
		hostname: { label: 'hostname', type: 'string' }
	    },
	    metric: inskMetric
	});

	inskHostname = mod_ca.caSysinfo().ca_hostname;
};

function inskMetric(metric)
{
	return (new insKstatMetric(metric));
}

function inskReducePercent(values)
{
	var result = 0;
	var ii;

	for (ii = 0; ii < values.length; ii++)
		result += values[ii];

	return (Math.floor(result / values.length));
}

function inskReduceSum(values)
{
	var result = 0;
	var ii;

	for (ii = 0; ii < values.length; ii++)
		result += values[ii];

	return (result);
}

var insk_stats = {
	cpu: {
		utilization: {
			module: 'cpu',
			class: 'misc',
			name: 'sys',
			reduce: inskReducePercent,
			map: function (deltas, interval) {
				return (Math.floor(100 *
				    (deltas['cpu_nsec_kernel'] +
				    deltas['cpu_nsec_user']) / interval));
			}
		}
	},
	io: {
		bytes: {
			module: 'sd',
			class: 'disk',
			reduce: inskReduceSum,
			map: function (deltas) {
				return (deltas['nwritten'] + deltas['nread']);
			}
		},
		ops: {
			module: 'sd',
			class: 'disk',
			reduce: inskReduceSum,
			map: function (deltas) {
				return (deltas['writes'] + deltas['reads']);
			}
		}
	},
	nic: {
		bytes: {
			module: 'e1000g',
			class: 'net',
			name: 'mac',
			reduce: inskReduceSum,
			map: function (deltas) {
				return (deltas['rbytes64'] +
				    deltas['obytes64']);
			}
		}
	}
};

function insKstatMetric(metric)
{
	var conf = insk_stats[metric.is_module][metric.is_stat];
	var kstatconf = {};
	var key;

	ASSERT.equal(metric.is_predicate.length, 0);
	ASSERT.ok(metric.is_decomposition.length <= 1);
	ASSERT.ok(metric.is_decomposition.length === 0 ||
	    (metric.is_decomposition.length == 1 &&
	    metric.is_decomposition[0] == 'hostname'));

	for (key in conf) {
		if (key != 'map' && key != 'reduce')
			kstatconf[key] = conf[key];
	}

	this.ikm_byhostname = metric.is_decomposition.length > 0;
	this.ikm_reader = new mod_kstat.Reader(kstatconf);
	this.ikm_map = conf['map'];
	this.ikm_reduce = conf['reduce'];
}

insKstatMetric.prototype.instrument = function (callback) { callback(); };
insKstatMetric.prototype.deinstrument = function (callback) { callback(); };

insKstatMetric.prototype.value = function ()
{
	var kstats, curval, deltas, interval, values, reduced;
	var ii, key, rv;

	kstats = this.ikm_reader.read();
	values = [];

	for (ii = 0; ii < kstats.length; ii++) {
		curval = this.ikm_reader.read()[ii];

		if (this.ikm_prev) {
			/* XXX wrong if the stats change underneath */
			interval = curval['snaptime'] -
			    this.ikm_prev[ii]['snaptime'];
			deltas = {};
			for (key in curval['data'])
				deltas[key] = curval['data'][key] -
				    this.ikm_prev[ii]['data'][key];
		} else {
			interval = curval['snaptime'];
			deltas = curval['data'];
		}

		values.push(this.ikm_map(deltas, interval));
	}

	this.ikm_prev = kstats;
	reduced = this.ikm_reduce(values);

	if (!this.ikm_byhostname)
		return (reduced);

	rv = {};
	rv[inskHostname] = reduced;
	return (rv);
};
