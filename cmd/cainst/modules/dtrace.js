/*
 * cmd/cainst/modules/dtrace.js: DTrace Instrumenter backend
 */

var mod_dtrace = require('libdtrace');
var mod_sys = require('sys');
var ASSERT = require('assert');

exports.insinit = function (ins)
{
	ins.registerModule({ name: 'syscall', label: 'System calls' });
	ins.registerMetric({
	    module: 'syscall',
	    stat: 'ops',
	    label: 'syscalls',
	    type: 'ops',
	    fields: {
		probefunc: { label: 'system call', type: 'string' },
		execname: { label: 'application name', type: 'string' }
	    },
	    metric: insdSyscalls
	});
};

function insdSyscalls(metric)
{
	var decomps = metric.is_decomposition;
	var script;

	ASSERT.ok(decomps.length < 2);

	script  = 'syscall:::entry\n';
	script += '{\n';
	script += '\t@';

	if (decomps.length > 0)
		script += '[' + decomps[0] + ']';

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
	console.log([ '---------------------', this.cad_prog,
	    '---------------------' ].join('\n'));
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
