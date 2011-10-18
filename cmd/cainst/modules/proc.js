/*
 * cmd/cainst/module/proc.js: /proc instrumenter backend
 */

var mod_assert = require('assert');

var mod_ca = require('../../../lib/ca/ca-common');
var mod_capred = require('../../../lib/ca/ca-pred');
var mod_caproc = require('../../../lib/ca/ca-proc');
var mod_cainstr = require('../../../lib/ca/ca-instr');

var inspLog;
var inspHostname;
var inspDataCache;
var inspRefresh = 5 * 1000; /* 5 seconds */

/*
 * Initialize the proc instrumenter backend
 */
exports.insinit = function (instr, log, callback) {
	inspLog = log;
	inspHostname = mod_ca.caSysinfo().ca_hostname;

	mod_caproc.caProcLoadCTF(function (err, ctype) {
		inspDataCache = new mod_caproc.caProcDataCache(ctype,
		    inspRefresh);
		inspInitMetrics(instr);
		callback();
	});
};

var inspMetrics = [ {
    module: 'unix',
    stat: 'processes',
    fields: [
	'hostname', 'execname', 'pid', 'ppid', 'rss', 'contract', 'psargs',
	'pmodel', 'nthreads', 'zonename'
    ],
    impl: inspProcessImpl
} ];

function inspInitMetrics(instr)
{
	inspMetrics.forEach(function (def) {
		instr.registerMetric({
			module: def['module'],
			stat: def['stat'],
			fields: def['fields'],
			impl: function (metric) {
				return (new def['impl'](def, metric, instr));
			}
		});
	});
}

/*
 * This metric implements the process backend
 */
function inspProcessImpl(desc, metric, instr)
{
	var onlyzones, bucketizers;

	this.ipm_metric = caDeepCopy(metric);
	this.ipm_fields = caDeepCopy(desc['fields']);

	if (metric.is_zones) {
		onlyzones = { or: metric.is_zones.map(function (zone) {
		    return ({ eq: [ 'zonename', zone ] });
		}) };

		if (mod_capred.caPredNonTrivial(metric.isPredicate))
			this.ipm_predicate = {
			    and: [onlyzones, metric.is_predicate ]
			};
		else
			this.ipm_predicate = onlyzones;
	} else {
		this.ipm_predicate = metric.is_predicate;
	}

	bucketizers = {};
	bucketizers['rss'] = mod_cainstr.caInstrLogLinearBucketize(10,
	    0, 11, 100);
	bucketizers['nthreads'] = mod_cainstr.caInstrLogLinearBucketize(10,
	    1, 6, 1000);

	this.ipm_applypred = instr.applyPredicate.bind(instr,
	    this.ipm_predicate);
	this.ipm_compute = instr.computeValue.bind(instr, bucketizers,
	    metric.is_decomposition);
}

inspProcessImpl.prototype.instrument = function (callback)
{
	callback();
};

inspProcessImpl.prototype.deinstrument = function (callback)
{
	callback();
};

inspProcessImpl.prototype.value = function (callback)
{
	var impl, res;

	impl = this;
	inspDataCache.data(function (objects) {
		var datapts, datapt, key;

		if (!objects)
			return (callback(undefined));

		datapts = [];
		for (key in objects) {
			datapt = {
			    fields: {
				hostname: inspHostname,
			        execname: objects[key]['pr_fname'],
				zonename: objects[key]['pr_zonename'],
				ppid: objects[key]['pr_ppid'].toString(),
				pid: objects[key]['pr_pid'].toString(),
				rss: objects[key]['pr_rssize'] * 1024,
				contract: objects[key]['pr_contract'],
				psargs: objects[key]['pr_psargs'],
				pmodel: objects[key]['pr_dmodel'] == 1 ?
				    '32-bit' : '64-bit',
				nthreads: objects[key]['pr_nlwp']
			    },
			    value: 1
			};

			if (datapt['value'] === undefined)
				continue;

			datapts.push(datapt);
		}

		datapts = impl.ipm_applypred(datapts);
		res = impl.ipm_compute(datapts);
		return (callback(res));
	});
};
