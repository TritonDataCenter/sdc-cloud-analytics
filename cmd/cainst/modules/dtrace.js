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
		hostname: { label: 'hostname', type: 'string' },
		zonename: { label: 'zone name', type: 'string' },
		syscall: { label: 'system call', type: 'string' },
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
		hostname: { label: 'hostname', type: 'string' },
		zonename: { label: 'zone name', type: 'string' },
		optype: { label: 'type', type: 'string' },
		execname: { label: 'application name', type: 'string' },
		latency: { label: 'latency', type: 'linear' }
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
	var latency = false;
	var script = '';
	var action, predicate, indexes, index, zero, ii;

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
		script += 'io:::start\n' + '{\n';

		if (latency)
		    script += '\tstarts[arg0] = timestamp;\n';

		for (ii = 0; ii < indexes.length; ii++)
			script += mod_ca.caSprintf('\t%ss[arg0] = %s;\n',
			    decomps[ii], indexes[ii]);

		script += '}\n\n';

		if (latency) {
			action = 'lquantize(timestamp - starts[arg0]' +
			    ', 0, 100000, 100);';
			predicate = '/starts[arg0]/\n';
		} else {
			action = 'count();';
			predicate = mod_ca.caSprintf('/%ss[arg0] != NULL/\n',
			    decomps[0]);
		}
	} else {
		action = 'count();';
		predicate = '';
	}

	script += 'io:::done\n';
	script += predicate;
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
