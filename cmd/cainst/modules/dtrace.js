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
	var ii;

	ASSERT.ok(decomps.length < 2);

	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			latency = true;
			decomps.splice(ii, 1);
			break;
		}
	}

	if (latency) {
		script += 'syscall:::entry\n' +
		    '{\n' +
		    '\tself->ts = timestamp;\n' +
		    '}\n\n';
	}

	script += 'syscall:::return\n';

	if (latency)
		script += '/self->ts/\n';

	script += '{\n';

	if (!latency) {
		script += '\t@';

		if (decomps.length > 0)
			script += '[' + decomps[0] + ']';

		script += ' = count();\n';
	}

	if (latency) {
		script += '\t@latency = ' +
		    'lquantize(timestamp - self->ts, 0, 100000, 100);\n';
		script += '\tself->ts = 0;\n';
	}

	script += '}\n';

	if (latency)
		return (new insDTraceLinearDecomp(script));

	if (decomps.length > 0)
		return (new insDTraceVectorMetric(script));

	return (new insDTraceScalarMetric(script));
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

	if (decomps.length > 0)
		return (new insDTraceVectorMetric(script));

	return (new insDTraceScalarMetric(script));
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

function insDTraceScalarMetric(prog)
{
	insDTraceMetric.call(this, prog);
}

mod_sys.inherits(insDTraceScalarMetric, insDTraceMetric);

insDTraceScalarMetric.prototype.reduce = function (agg)
{
	for (var aggid in agg) {
		for (var aggkey in agg[aggid])
			return (agg[aggid][aggkey]);
	}

	return (0);
};

function insDTraceVectorMetric(prog)
{
	insDTraceMetric.call(this, prog);
}

mod_sys.inherits(insDTraceVectorMetric, insDTraceMetric);

insDTraceVectorMetric.prototype.reduce = function (agg)
{
	for (var aggid in agg)
		return (agg[aggid]);

	return ({});
};

function insDTraceLinearDecomp(prog)
{
	insDTraceMetric.call(this, prog);
}

mod_sys.inherits(insDTraceLinearDecomp, insDTraceMetric);

insDTraceLinearDecomp.prototype.reduce = function (agg)
{
	var aggid;

	for (aggid in agg)
		return (agg[aggid]['']);
};
