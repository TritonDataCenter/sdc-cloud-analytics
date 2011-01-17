/*
 * cmd/cainst/modules/dtrace.js: DTrace Instrumenter backend
 */

var mod_ca = require('../../../lib/ca/ca-common');
var mod_dtrace = require('libdtrace');
var mod_sys = require('sys');
var ASSERT = require('assert');

var insd_log;

exports.insinit = function (ins, log)
{
	insd_log = log;
	ins.registerModule({ name: 'syscall', label: 'System calls' });
	ins.registerMetric({
	    module: 'syscall',
	    stat: 'ops',
	    label: 'syscalls',
	    type: 'ops',
	    fields: {
		hostname: { label: 'hostname', type: 'string' },
		zonename: { label: 'zone name', type: 'string' },
		syscall: { label: 'system call', type: 'string' },
		execname: { label: 'application name', type: 'string' },
		latency: { label: 'latency', type: 'numeric' }
	    },
	    metric: insdSyscalls
	});

	ins.registerModule({ name: 'io', label: 'Disk I/O' });
	ins.registerMetric({
	    module: 'io',
	    stat: 'ops',
	    label: 'operations',
	    type: 'ops',
	    fields: {
		hostname: { label: 'hostname', type: 'string' },
		zonename: { label: 'zone name', type: 'string' },
		optype: { label: 'type', type: 'string' },
		execname: { label: 'application name', type: 'string' },
		latency: { label: 'latency', type: 'numeric' }
	    },
	    metric: insdIops
	});

};

var insdFields = {
	hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
	zonename: 'zonename',
	syscall: 'probefunc',
	execname: 'execname',
	optype: '(args[0]->b_flags & B_READ ? "read" : "write")'
};

function insdMakePredicate(predicates)
{
	if (predicates.length === 0)
		return ('');

	return ('/' + predicates.map(function (elt) {
	    return ('(' + elt + ')');
	}).join(' &&\n') + '/\n');
}

function insdSyscalls(metric)
{
	var decomps = metric.is_decomposition;
	var latency = false;
	var script = '';
	var action, predicates, zones, indexes, index, zero, ii;

	predicates = [];

	if (metric.is_zones) {
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			latency = true;
			continue;
		}

		ASSERT.ok(decomps[ii] in insdFields);
		indexes.push(insdFields[decomps[ii]]);
	}

	ASSERT.ok(indexes.length < 2); /* could actually support more */

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = latency ? [] : 0;
	}

	if (latency) {
		action = 'lquantize(timestamp - self->ts, 0, 100000, 100);';
		script += 'syscall:::entry\n' +
		    insdMakePredicate(predicates) +
		    '{\n' +
		    '\tself->ts = timestamp;\n' +
		    '}\n\n';
		predicates = [ 'self->ts' ];
	} else {
		action = 'count();';
	}

	script += 'syscall:::return\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);

	if (latency)
		script += '\tself->ts = 0;\n';

	script += '}\n';

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero));
}

function insdIops(metric)
{
	var decomps = metric.is_decomposition;
	var latency = false;
	var script = '';
	var action, predicates, zones, indexes, index, zero, ii;

	predicates = [];

	if (metric.is_zones) {
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			latency = true;
			decomps.splice(ii--, 1);
			continue;
		}

		ASSERT.ok(decomps[ii] in insdFields);
		indexes.push(insdFields[decomps[ii]]);
	}

	ASSERT.ok(indexes.length < 2); /* could actually support more */

	if (indexes.length > 0) {
		index = '[' + decomps.map(function (elt) {
			return (elt + 's[arg0]');
		}).join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = latency ? [] : 0;
	}

	if (latency || indexes.length > 0) {
		script += 'io:::start\n';
		script += insdMakePredicate(predicates);
		script += '{\n';

		if (latency)
		    script += '\tstarts[arg0] = timestamp;\n';

		for (ii = 0; ii < indexes.length; ii++)
			script += mod_ca.caSprintf('\t%ss[arg0] = %s;\n',
			    decomps[ii], indexes[ii]);

		script += '}\n\n';

		if (latency) {
			action = 'lquantize(timestamp - starts[arg0]' +
			    ', 0, 100000, 100);';
			predicates = [ 'starts[arg0]' ];
		} else {
			action = 'count();';
			predicates = [ mod_ca.caSprintf(
			    '%ss[arg0] != NULL', decomps[0]) ];
		}
	} else {
		action = 'count();';
	}

	script += 'io:::done\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);

	if (latency)
		script += '\tstarts[arg0] = 0;\n';

	for (ii = 0; ii < indexes.length; ii++)
		script += mod_ca.caSprintf('\t%ss[arg0] = 0\n', decomps[ii]);

	script += '}\n';

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero));
}

function insDTraceMetric(prog)
{
	this.cad_prog = prog;
}

insDTraceMetric.prototype.instrument = function (callback)
{
	var sep = '----------------------------------------';

	/*
	 * Only log the script on the first time through here.
	 */
	if (this.cad_dtr === undefined)
		insd_log.dbg('\n%s\n%s%s', sep, this.cad_prog, sep);

	this.cad_dtr = new mod_dtrace.Consumer();

	try {
		this.cad_dtr.strcompile(this.cad_prog);
		this.cad_dtr.go();

		if (callback)
			callback();
	} catch (ex) {
		insd_log.error('instrumentation failed; exception follows');
		insd_log.exception(ex);
		this.cad_dtr = null;
		if (callback)
			callback(ex);
	}
};

insDTraceMetric.prototype.deinstrument = function (callback)
{
	this.cad_dtr.stop();
	this.cad_dtr = null;

	if (callback)
		callback();
};

insDTraceMetric.prototype.value = function ()
{
	var agg = {};
	var iteragg = function (id, key, val) {
		if (!(id in agg))
			agg[id] = {};

		agg[id][key] = val;
	};

	/*
	 * If we failed to instrument, all we can do is return an error.
	 * Because the instrumenter won't call value() except after a successful
	 * instrument(), this can only happen if we successfully enable the
	 * instrumentation but DTrace aborts sometime later and we fail to
	 * reenable it.
	 */
	if (!this.cad_dtr)
		return (undefined);

	try {
		this.cad_dtr.aggwalk(iteragg);
	} catch (ex) {
		/*
		 * In some cases (such as simple drops), we could reasonably
		 * ignore this and drive on.  Or we could stop this consumer,
		 * increase the buffer size, and re-enable.  In some cases,
		 * though, the consumer has already aborted so we have to create
		 * a new handle and re-enable.  For now, we deal with all of
		 * these the same way: create a new handle and re-enable.
		 * XXX this should be reported to the configuration service as
		 * an asynchronous instrumenter error.
		 * XXX shouldn't all log entries be reported back to the
		 * configuration service for debugging?
		 */
		insd_log.error('re-enabling instrumentation due to error ' +
		    'reading aggregation. exception follows:');
		insd_log.exception(ex);
		this.instrument();
		return (undefined);
	}

	return (this.reduce(agg));
};

function insDTraceVectorMetric(prog, hasdecomps, zero)
{
	this.cadv_decomps = hasdecomps;
	this.cadv_zero = zero;
	insDTraceMetric.call(this, prog);
}

mod_sys.inherits(insDTraceVectorMetric, insDTraceMetric);

insDTraceVectorMetric.prototype.reduce = function (agg)
{
	var aggid;

	for (aggid in agg) {
		if (!this.cadv_decomps)
			return (agg[aggid]['']);

		return (agg[aggid]);
	}

	return (this.cadv_zero);
};
