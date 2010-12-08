/*
 * cmd/cainst/modules/dtrace.js: DTrace Instrumenter backend
 */

var mod_ca = require('ca');
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
		probefunc: { label: 'system call', type: 'string' },
		execname: { label: 'application name', type: 'string' },
		latency: { label: 'latency', type: 'linear' }
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
		hosttype: { label: 'host and type', type: 'string' }
	    },
	    metric: insdIops
	});

};

function insdSyscalls(metric)
{
	var decomps = metric.is_decomposition;
	var latency = false;
	var script = '';
	var action, predicate, indexes, index, zero, ii;

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			latency = true;
			continue;
		}

		indexes.push(decomps[ii]);
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
		predicate = '/self->ts/\n';
		script += 'syscall:::entry\n' +
		    '{\n' +
		    '\tself->ts = timestamp;\n' +
		    '}\n\n';
	} else {
		action = 'count();';
		predicate = '';
	}

	script += 'syscall:::return\n';
	script += predicate + '\n';
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
	var script = '';
	var host = mod_ca.caSysinfo().ca_hostname;

	script += 'io:::start\n';
	script += '{\n';
	script += '\t@';

	if (decomps.length > 0)
		script += mod_ca.caSprintf('[ strjoin("%s", ' +
		    'args[0]->b_flags & B_READ ? ": reads" : ": writes") ]',
		    host);

	script += ' = count();\n';
	script += '}\n';

	return (new insDTraceVectorMetric(script, decomps.length > 0));
}

function insDTraceMetric(prog)
{
	this.cad_prog = prog;
	this.cad_dtr = new mod_dtrace.Consumer();
}

insDTraceMetric.prototype.instrument = function (callback)
{
	var sep = '----------------------------------------';
	insd_log.dbg('\n%s\n%s%s', sep, this.cad_prog, sep);
	this.cad_dtr.strcompile(this.cad_prog);
	this.cad_dtr.go(); /* XXX should be asynch? */
	callback();
};

insDTraceMetric.prototype.deinstrument = function (callback)
{
	this.cad_dtr.stop(); /* XXX can object be reused? */
	callback();
};

insDTraceMetric.prototype.value = function ()
{
	var agg = {};

	this.cad_dtr.aggwalk(function (id, key, val) {
		if (!(id in agg))
			agg[id] = {};

		agg[id][key] = val;
	});

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
