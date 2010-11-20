/*
 * cmd/cainst/modules/dtrace.js: DTrace Instrumenter backend
 */

var mod_dtrace = require('libdtrace');
var mod_sys = require('sys');

exports.insinit = function (ins)
{
	ins.registerModule({ name: 'syscall', label: 'System calls' });
	ins.registerMetric({
	    module: 'syscall',
	    stat: 'ops',
	    label: 'operations',
	    type: 'ops',
	    fields: [],
	    metric: insdScalarMetric
	});
	ins.registerMetric({
	    module: 'syscall',
	    stat: 'opsbyexecname', /* XXX */
	    label: 'operations',
	    type: 'ops',
	    fields: {
		syscall: { label: 'system call', type: 'string' },
		execname: { label: 'application name', type: 'string' }
	    },
	    metric: insdVectorMetric
	});
};

var syscalls_dscript = [
    'syscall:::entry',
    '{',
    '    @ = count();',
    '}'
].join('\n');

function insdScalarMetric()
{
	return (new insDTraceScalarMetric(syscalls_dscript));
}

var syscalls_byexecname = [
    'syscall:::entry',
    '{',
    '    @[execname] = count();',
    '}'
].join('\n');

function insdVectorMetric()
{
	return (new insDTraceVectorMetric(syscalls_byexecname));
}

function insDTraceMetric(prog)
{
	this.cad_prog = prog;
	this.cad_dtr = new mod_dtrace.Consumer();
}

insDTraceMetric.prototype.instrument = function (callback)
{
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
