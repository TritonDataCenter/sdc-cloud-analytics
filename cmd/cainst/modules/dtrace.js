/*
 * cmd/cainst/modules/dtrace.js: DTrace Instrumenter backend
 */

var mod_ca = require('../../../lib/ca/ca-common');
var mod_dtrace = require('libdtrace');
var mod_capred = require('../../../lib/ca/ca-pred');
var mod_caagg = require('../../../lib/ca/ca-agg');
var mod_sys = require('sys');
var ASSERT = require('assert');

var insd_log;
var insd_dt_bufsize = '16k';		/* principal buffer size */
var insd_dt_cleanrate = '101hz';	/* cleaning rate */
var insd_dt_dynvarsize = '32M';		/* dynamic variable space */
var insd_dt_strsize = '128';		/* string size */
var insd_dt_libpath = [];		/* DTrace library Path (-L) */
var insd_nenablings = 0;		/* number of active enablings */

if (process.env['DTRACE_LIBPATH']) {
	insd_dt_libpath = process.env['DTRACE_LIBPATH'].split(':');
}

exports.insinit = function (ins, log)
{
	insd_log = log;

	ins.registerReporter('dtrace', insdStatus);

	ins.registerModule({ name: 'syscall', label: 'System calls' });
	ins.registerMetric({
	    module: 'syscall',
	    stat: 'ops',
	    label: 'syscalls',
	    type: 'ops',
	    fields: {
		hostname: { label: 'hostname', type: mod_ca.ca_type_string },
		zonename: { label: 'zone name', type: mod_ca.ca_type_string },
		syscall: { label: 'system call', type: mod_ca.ca_type_string },
		execname: { label: 'application name',
		    type: mod_ca.ca_type_string },
		latency: { label: 'latency', type: mod_ca.ca_type_latency }
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
		hostname: { label: 'hostname', type: mod_ca.ca_type_string },
		zonename: { label: 'zone name', type: mod_ca.ca_type_string },
		optype: { label: 'type', type: mod_ca.ca_type_string },
		execname: { label: 'application name',
		    type: mod_ca.ca_type_string },
		latency: { label: 'latency', type: mod_ca.ca_type_latency }
	    },
	    metric: insdIops
	});

	ins.registerModule({ name: 'node', label: 'Node.js 0.4.x' });
	ins.registerMetric({
	    module: 'node',
	    stat: 'httpd_ops',
	    label: 'HTTP server operations',
	    type: 'ops',
	    fields: {
		method: { label: 'method', type: mod_ca.ca_type_string },
		url: { label: 'URL', type: mod_ca.ca_type_string },
		raddr: { label: 'remote IP address',
		    type: mod_ca.ca_type_ipaddr },
		rport: { label: 'remote TCP port',
		    type: mod_ca.ca_type_string },
		latency: { label: 'latency', type: mod_ca.ca_type_latency }
	    },
	    metric: insdNodeHttpd
	});

	ins.registerMetric({
	    module: 'node',
	    stat: 'httpc_ops',
	    label: 'HTTP client operations',
	    type: 'ops',
	    fields: {
		method: { label: 'method', type: mod_ca.ca_type_string },
		url: { label: 'URL', type: mod_ca.ca_type_string },
		raddr: { label: 'http server address',
		    type: mod_ca.ca_type_string },
		rport: { label: 'http server port',
		    type: mod_ca.ca_type_string },
		latency: { label: 'latency', type: mod_ca.ca_type_latency }
	    },
	    metric: insdNodeHttpc
	});

	ins.registerMetric({
	    module: 'node',
	    stat: 'gc_ops',
	    label: 'garbage collection operations',
	    type: 'ops',
	    fields: {
		type: { label: 'gc type', type: mod_ca.ca_type_string },
		latency: { label: 'latency', type: mod_ca.ca_type_latency }
	    },
	    metric: insdNodeGC
	});

	ins.registerMetric({
	    module: 'node',
	    stat: 'socket_ops',
	    type: 'ops',
	    label: 'socket operations',
	    fields: {
		type: { label: 'type', type: mod_ca.ca_type_string },
		raddr: { label: 'remote host', type: mod_ca.ca_type_string },
		rport: { label: 'remote port', type: mod_ca.ca_type_string },
		size: { label: 'size', type: mod_ca.ca_type_number },
		buffered: {
		    label: 'buffered data',
		    type: mod_ca.ca_type_number
		}
	    },
	    metric: insdNodeSocket
	});

	ins.registerMetric({
	    module: 'cpu',
	    stat: 'thread_executions',
	    type: 'ops',
	    label: 'thread executions',
	    fields: {
		runtime: { label: 'runtime', type: mod_ca.ca_type_latency },
		pid: {
		    label: 'process identifier',
		    type: mod_ca.ca_type_string
		},
		execname: {
		    label: 'application name',
		    type: mod_ca.ca_type_string
		},
		zonename: {
		    label: 'zone name',
		    type: mod_ca.ca_type_string
		},
		leavereason: {
		    label: 'reason leaving cpu',
		    type: mod_ca.ca_type_string
		}
/*
 * We aren't using these for now until we better understand them.
 *
 *		leavepid: {
 *		    label: 'process identifier taking over cpu',
 *		    type: mod_ca.ca_type_string
 *		},
 *		leaveexec: {
 *		    label: 'application name taking over cpu',
 *		    type: mod_ca.ca_type_string
 *		},
 *		leavezone: {
 *		    label: 'zone name taking over cpu',
 *		    type: mod_ca.ca_type_string
 *		}
 */
	    },
	    metric: insdCpuThrExec
	});

	ins.registerModule({ name: 'fs', label: 'Filesystem' });
	ins.registerMetric({
	    module: 'fs',
	    stat: 'logical_ops',
	    type: 'ops',
	    label: 'logical filesystem operations',
	    fields: {
		pid: {
		    label: 'process identifier',
		    type: mod_ca.ca_type_string
		},
		execname: {
		    label: 'application name',
		    type: mod_ca.ca_type_string
		},
		zonename: {
		    label: 'zone name',
		    type: mod_ca.ca_type_string
		},
/*
 * We are not currently enabling filenames because our table gets rather large
 * very quickly ~1000+ elements. Once that happens, jquery gets into bad shape
 * and the browsers start getting upset.
 *
 *		filename: {
 *		    label: 'file name',
 *		    type: mod_ca.ca_type_string
 *		},
 */
		operation: {
		    label: 'operation type',
		    type: mod_ca.ca_type_string
		},
		fstype: {
		    label: 'filesystem type',
		    type: mod_ca.ca_type_string
		},
		latency: { label: 'latency', type: mod_ca.ca_type_latency }
	    },
	    metric: insdLogFSIO
	});
};

function insdStatus()
{
	var ret = {};
	ret['dtrace_libpath'] = insd_dt_libpath;
	ret['dtrace_bufsize'] = insd_dt_bufsize;
	ret['dtrace_cleanrate'] = insd_dt_cleanrate;
	ret['dtrace_dynvarsize'] = insd_dt_dynvarsize;
	ret['dtrace_strsize'] = insd_dt_strsize;
	ret['nenablings'] = insd_nenablings;
	return (ret);
}

var insdFields = {
	hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
	zonename: 'zonename',
	syscall: 'probefunc',
	execname: 'execname',
	optype: '(args[0]->b_flags & B_READ ? "read" : "write")'
};

/*
 * A utility to create the probe-specific insdFields object
 */
function insFieldsCreate(obj)
{
	var copy = mod_ca.caDeepCopy(insdFields);
	mod_ca.caDeepCopyInto(copy, obj);
	return (copy);
}

function insdMakePredicate(predicates)
{
	if (predicates.length === 0)
		return ('');

	return ('/' + predicates.map(function (elt) {
	    return ('(' + elt + ')');
	}).join(' &&\n') + '/\n');
}

/*
 * Helper function to generate the xlate call. Arguments refer to the following:
 *
 *	outtype:	The type we should covert to
 *
 *	inttype:	The type we should convert from and arg%d should be
 *			considered
 *
 *	argNo:		The arg number for this prove, i.e. arg0, arg1
 *
 *	arg:		The struct field to deference
 */
function insdXlate(outtype, inttype, argNo, arg)
{
	return (mod_ca.caSprintf('((xlate <%s *>((%s *)arg%d))->%s)',
	    outtype, inttype, argNo, arg));
}

function insdPragmaZone(zone)
{
	return (mod_ca.caSprintf('#pragma D option zone=%s\n\n', zone));
}

/*
 * Return the default llquantize
 */
function insdLlquantize(arg)
{
	return (mod_ca.caSprintf('llquantize((%s), 10, 3, 11, 100)', arg));
}

function insdSyscalls(metric)
{
	var decomps = metric.is_decomposition;
	var hasPredicate = false;
	var aggLatency = false;
	var traceLatency = false;
	var script = '';
	var action, predicates, zones, indexes, index, zero, ii, pred;

	predicates = [];

	hasPredicate = mod_capred.caPredNonTrivial(metric.is_predicate);

	if (metric.is_zones) {
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			traceLatency = true;
			aggLatency = true;
			continue;
		}

		ASSERT.ok(decomps[ii] in insdFields);
		indexes.push(insdFields[decomps[ii]]);
	}

	if (mod_capred.caPredContainsField('latency', metric.is_predicate))
		traceLatency = true;

	ASSERT.ok(indexes.length < 2); /* could actually support more */

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = aggLatency ? [] : 0;
	}

	if (traceLatency) {
		script += 'syscall:::entry\n' +
		    insdMakePredicate(predicates) +
		    '{\n' +
		    '\tself->ts = timestamp;\n' +
		    '}\n\n';
		predicates = [ 'self->ts' ];
	}

	if (aggLatency) {
		action = insdLlquantize('timestamp - self->ts') + ';';
	} else {
		action = 'count();';
	}

	if (hasPredicate) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields(insFieldsCreate({
		    latency: '(timestamp - self->ts)'
		}), pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}


	script += 'syscall:::return\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);

	script += '}\n';

	if (traceLatency) {
		script += '\nsyscall:::return\n';
		script += '{\n';

		script += '\tself->ts = 0;\n';

		script += '}\n';
	}

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero,
	    aggLatency));

}

function insdCheckZonesMetric(zones)
{
	ASSERT.ok(zones instanceof Array);
	ASSERT.ok(zones.length > 0);
}

function insdIops(metric)
{
	var decomps = metric.is_decomposition;
	var script = '';
	var ii, predicates, zones, indexes, zero, index;
	var fields, before, hasPredicate, pred;
	var aggLatency, action;
	var transforms = {
	    latency: '(timestamp - latencys[arg0])',
	    zonename: 'zonenames[arg0]',
	    hostname: 'hostnames[arg0]',
	    execname: 'execnames[arg0]',
	    optype: '(args[0]->b_flags & B_READ ? "read" : "write")'
	};

	predicates = [];
	before = [];

	hasPredicate = mod_capred.caPredNonTrivial(metric.is_predicate);
	fields = mod_capred.caPredFields(metric.is_predicate);

	if (metric.is_zones) {
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));

		if (!mod_ca.caArrayContains(fields, 'zonename'))
			fields.push('zonename');
	}

	/*
	 * The indexes variable is being used to determine how we aggregate the
	 * data ultimately where as the fields, determine which data we need to
	 * store during the entry probe
	 */
	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			aggLatency = true;
			if (!mod_ca.caArrayContains(fields, decomps[ii]))
				fields.push(decomps[ii]);
			decomps.splice(ii--, 1);
			continue;
		}

		ASSERT.ok(decomps[ii] in transforms);
		if (!mod_ca.caArrayContains(fields, decomps[ii]))
			fields.push(decomps[ii]);

		indexes.push(transforms[decomps[ii]]);
	}

	ASSERT.ok(indexes.length < 2); /* could actually support more */

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = aggLatency ? [] : 0;
	}

	for (ii = 0; ii < fields.length; ii++) {
		if (fields[ii] != 'optype')
			before.push(fields[ii]);
	}

	if (before.length > 0) {
		script += 'io:::start\n';
		script += '{\n';

		for (ii = 0; ii < before.length; ii++) {
			switch (before[ii]) {
			case 'latency':
				script += '\tlatencys[arg0] = timestamp;\n';
				break;
			default:
				script += mod_ca.caSprintf(
				    '\t%ss[arg0] = %s;\n', before[ii],
				    insdFields[before[ii]]);
				break;
			}
		}
		script += '}\n\n';
	}

	if (aggLatency) {
		action = insdLlquantize('(timestamp - latencys[arg0]') + ';';
	} else {
		action = 'count();';
	}

	if (before.length > 0) {
		predicates.push(mod_ca.caSprintf('%ss[arg0] != NULL',
		    before[0]));
	}

	if (hasPredicate) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields(transforms, pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}

	script += 'io:::done\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);
	script += '}\n\n';

	if (before.length > 0 || mod_ca.caArrayContains(fields, 'latency')) {
		script += 'io:::done\n';
		script += '{\n';

		for (ii = 0; ii < before.length; ii++)
			script += mod_ca.caSprintf('\t%ss[arg0] = 0;\n',
			    before[ii]);

		script += '}\n';
	}

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero,
	    aggLatency));
}

/*
 * The node http client and server probes are virutally identical. The only
 * thigns that need to change are the names of the probes that we're firing.
 *
 *	metric:		The metric we were requested to build
 *
 *	entryp:		The first probe that we're going to fire
 *
 *	returnp:	The final probe that we're going to fire
 *
 * return:
 * Returns the DTrace metric or thows an exception on error
 */
function insdNodeHttpCreate(metric, entryp, returnp)
{
	var decomps = metric.is_decomposition;
	var pred = metric.is_predicate;
	var script = '';
	var ii, predicates, hasPred, fields, zones, indexes, index;
	var before, zero, aggLatency, action;
	var arg0fd = insdXlate('node_connection_t', 'node_dtrace_connection_t',
	    0, 'fd');
	var arg1fd = insdXlate('node_connection_t', 'node_dtrace_connection_t',
	    1, 'fd');
	var arg0raddr = insdXlate('node_connection_t',
	    'node_dtrace_connection_t', 0, 'remoteAddress');
	var arg0port = insdXlate('node_connection_t',
	    'node_dtrace_connection_t', 0, 'remotePort');
	var arg0method = insdXlate('node_http_request_t',
	    'node_dtrace_http_request_t', 0, 'method');
	var arg0url = insdXlate('node_http_request_t',
	    'node_dtrace_http_request_t', 0, 'url');

	var transforms = {
	    latency: '((timestamp - latencys[' + arg0fd + ']))',
	    method: '(methods['+ arg0fd + '])',
	    url: '(urls['+ arg0fd + '])',
	    raddr: '(' + arg0raddr + ')',
	    rport: 'lltostr(' + arg0port + ')'
	};

	predicates = [];

	hasPred = mod_capred.caPredNonTrivial(pred);
	fields = mod_capred.caPredFields(pred);

	if (metric.is_zones) {
		ASSERT.ok(metric.is_zones.length == 1);
		script += insdPragmaZone(metric.is_zones[0]);
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			aggLatency = true;
			if (!mod_ca.caArrayContains(fields, decomps[ii]))
				fields.push(decomps[ii]);
			decomps.splice(ii--, 1);
			continue;
		}

		if (!mod_ca.caArrayContains(fields, decomps[ii]))
			fields.push(decomps[ii]);

		indexes.push(transforms[decomps[ii]]);
	}

	ASSERT.ok(indexes.length < 2); /* could actually support more */

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = aggLatency ? [] : 0;
	}

	before = [];
	for (ii = 0; ii < fields.length; ii++) {
		if (fields[ii] != 'raddr' && fields[ii] != 'rport')
			before.push(fields[ii]);
	}

	if (before.length > 0) {
		script += 'node*:::' + entryp + '\n';
		script += '{\n';

		for (ii = 0; ii < before.length; ii++) {
			switch (before[ii]) {
			case 'latency':
				script += '\tlatencys[' + arg1fd + '] = ' +
				    'timestamp;\n';
				break;
			case 'method':
				script += '\tmethods[' + arg1fd + '] = ' +
				    arg0method + ';\n';
				break;
			case 'url':
				script += '\turls[' + arg1fd + '] = ' +
				    arg0url + ';\n';
				break;
			default:
				throw (new Error('invalid field for ' +
				    'node-httpd' + before[ii]));
			}
		}

		script += '}\n\n';
	}

	if (aggLatency) {
		action = insdLlquantize(transforms['latency']) + ';';
	} else {
		action = 'count();';
	}

	if (before.length > 0) {
		predicates.push(mod_ca.caSprintf('%ss[%s] != NULL',
		    before[0], arg0fd));
	}

	if (hasPred) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields(transforms, pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}

	script += 'node*:::' + returnp + '\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);
	script += '}\n\n';

	if (before.length > 0) {
		script += 'node*:::' + returnp + '\n';
		script += '{\n';

		for (ii = 0; ii < before.length; ii++)
			script += mod_ca.caSprintf('\t%ss[%s] = 0;\n',
			    before[ii], arg0fd);

		script += '}\n';
	}

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero,
	    aggLatency));

}

function insdNodeHttpd(metric)
{
	var ii;
	var zones = metric.is_zones;
	var progs = [];

	if (zones !== undefined) {
		insdCheckZonesMetric(zones);

		for (ii = 0; ii < zones.length; ii++) {
			metric.is_zones = [ zones[ii] ];
			progs.push(insdNodeHttpCreate(mod_ca.caDeepCopy(metric),
			    'http-server-request',
			    'http-server-response'));
		}

		metric.is_zones = zones;
		return (new insDTraceMetricArray(progs));
	} else {
		return (insdNodeHttpCreate(metric, 'http-server-request',
		    'http-server-response'));
	}
}

function insdNodeHttpc(metric)
{
	var ii;
	var zones = metric.is_zones;
	var progs = [];

	if (zones !== undefined) {
		insdCheckZonesMetric(zones);

		for (ii = 0; ii < zones.length; ii++) {
			metric.is_zones = [ zones[ii] ];
			progs.push(insdNodeHttpCreate(mod_ca.caDeepCopy(metric),
			    'http-client-request',
			    'http-client-response'));
		}

		metric.is_zones = zones;
		return (new insDTraceMetricArray(progs));
	} else {
		return (insdNodeHttpCreate(metric, 'http-client-request',
		    'http-client-response'));
	}
}

/*
 * Notes on v8 GC implementation: As of v8 version 3.1.1 (Feb 4, 2011), v8 has
 * two different types of garbage collection:
 *	Scavenge
 * 	Mark and Sweep
 *
 * When GC runs, the entire world stops, only one thread is running the GC
 * itself. Furthermore, currently the GC prologue and epilogue callbacks are all
 * done in the same thread, so we can use thread local variables.
 */
function insdNodeGCImpl(metric)
{
	var decomps = metric.is_decomposition;
	var script = '';
	var predicates, zones, zero, hasPred, aggLatency, traceLatency;
	var pred, fields, ii, indexes, index, action;
	var transforms = {
	    latency: '(timestamp - self->ts)',
	    type: '(arg0 == 1 ? "scavenge" : (arg0 == 2 ? "mark and sweep" : ' +
		'"scavenge and mark and sweep"))'
	};

	predicates = [];
	hasPred = mod_capred.caPredNonTrivial(pred);
	fields = mod_capred.caPredFields(pred);

	if (metric.is_zones) {
		ASSERT.ok(metric.is_zones.length == 1);
		script += insdPragmaZone(metric.is_zones[0]);
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'latency') {
			aggLatency = true;
			traceLatency = true;
			if (!mod_ca.caArrayContains(fields, decomps[ii]))
				fields.push(decomps[ii]);
			decomps.splice(ii--, 1);
			continue;
		}

		if (!mod_ca.caArrayContains(fields, decomps[ii]))
			fields.push(decomps[ii]);

		indexes.push(transforms[decomps[ii]]);
	}

	ASSERT.ok(indexes.length < 2); /* could actually support more */

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = aggLatency ? [] : 0;
	}

	if (mod_ca.caArrayContains(fields, 'latency'))
		traceLatency = true;

	if (traceLatency) {
		script += 'node*:::gc-start\n';
		script += '{\n';
		script += '\tself->ts = timestamp;\n';
		script += '}\n\n';

		predicates.push('self->ts != NULL');
	}

	if (aggLatency) {
		action = insdLlquantize(transforms['latency']) + ';';
	} else {
		action = 'count();';
	}

	if (hasPred) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields(transforms, pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}

	script += 'node*:::gc-done\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);
	script += '}\n\n';

	if (traceLatency) {
		script += 'node*:::gc-done\n';
		script += '{\n';
		script += '\tself->ts = 0;\n';
		script += '}\n';
	}

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero,
	    aggLatency));
}

function insdNodeGC(metric)
{
	var ii;
	var zones = metric.is_zones;
	var progs = [];

	if (zones !== undefined) {
		insdCheckZonesMetric(zones);

		for (ii = 0; ii < zones.length; ii++) {
			metric.is_zones = [ zones[ii] ];
			progs.push(insdNodeGCImpl(mod_ca.caDeepCopy(metric)));
		}

		metric.is_zones = zones;
		return (new insDTraceMetricArray(progs));
	} else {
		return (insdNodeGCImpl(metric));
	}
}


function insdNodeSocketImpl(metric)
{
	var script = '';
	var decomps = metric.is_decomposition;
	var pred = metric.is_predicate;
	var aggBuff = false;
	var aggSize = false;
	var ii, zones, predicates, hasPred, index, indexes, zero, action;
	var arg0addr = insdXlate('node_connection_t',
	    'node_dtrace_connection_t', 0, 'remoteAddress');
	var arg0port = insdXlate('node_connection_t',
	    'node_dtrace_connection_t', 0, 'remotePort');
	var arg0buffer = insdXlate('node_connection_t',
	    'node_dtrace_connection_t', 0, 'bufferSize');
	var transforms = {
	    type: '(probename == "net-socket-read" ? "read" : "write")',
	    raddr: arg0addr,
	    rport: 'lltostr( ' + arg0port + ')',
	    size: 'arg1',
	    buffered: arg0buffer
	};

	predicates = [];
	hasPred = mod_capred.caPredNonTrivial(pred);

	if (metric.is_zones) {
		ASSERT.ok(metric.is_zones.length == 1);
		script += insdPragmaZone(metric.is_zones[0]);
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		if (decomps[ii] == 'size') {
			aggSize = true;
		} else if (decomps[ii] == 'buffered') {
			aggBuff = true;
		} else {
			indexes.push(transforms[decomps[ii]]);
		}
	}

	/* We may have both a numeric and discrete decomp at the same time */
	ASSERT.ok(indexes.length < 2);

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = 0;
	}

	if (aggBuff) {
		action = insdLlquantize(transforms['buffered']) + ';';
	} else if (aggSize) {
		action = insdLlquantize(transforms['size']) + ';';
	} else {
		action = 'count();';
	}

	if (hasPred) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields(transforms, pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}

	script += 'node*:::net-socket-read,\n';
	script += 'node*:::net-socket-write\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);
	script += '}\n\n';

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero,
	    action != 'count();'));
}

function insdNodeSocket(metric)
{
	var ii;
	var zones = metric.is_zones;
	var progs = [];

	if (zones !== undefined) {
		insdCheckZonesMetric(zones);

		for (ii = 0; ii < zones.length; ii++) {
			metric.is_zones = [ zones[ii] ];
			progs.push(insdNodeSocketImpl(
			    mod_ca.caDeepCopy(metric)));
		}

		metric.is_zones = zones;
		return (new insDTraceMetricArray(progs));
	} else {
		return (insdNodeSocketImpl(metric));
	}
}

/*
 * Customers want to know why they're leaving CPU and who is taking over from
 * them. They should be able to know another customer is taking over, but not
 * who they are or what they are running, just that this is the mythical "other
 * customer". However, if the zone belongs to them, they should be able to see
 * it just fine.
 *
 * This function creates a D expression that checks whether or not the zone that
 * we are in is in the list of zones. If it is, we return the actual data that
 * we want, if we aren't, we return an expression that says something is
 * invalid. If the list of zones is null, then we are operating as someone who
 * has full root on the Global Zone and should be able to always see this
 * information.
 *
 *	zinfo		A D expression that tells us what zone we are in
 *
 *	arg		A D expression that tells us what value should be
 *			returned if the zone matches
 *
 *	zones		A list of zone names that can see the data, or null if
 *			it should always be accessible
 *
 *	inval		The D expression to return when the user cannot see the
 *			data, this must be the same D type as "arg".
 *
 */
function insdCpuThrSeeField(zinfo, arg, zones, inval)
{
	var ii;
	var ret = '';

	if (!zones)
		return (arg);

	for (ii = 0; ii < zones.length; ii++)
		ret += caSprintf('%s == "%s" ? %s : ', zinfo, zones[ii], arg);

	ret += '"' + inval + '"';

	return (ret);
}

function insdCpuThrExec(metric)
{
	var script = '';
	var decomps = metric.is_decomposition;
	var pred = metric.is_predicate;
	var aggRuntime = false;
	var traceRuntime = false;
	var onlySrun = false;
	var predicates, hasPred, ii, indexes, zero, action, index;
	var nextzone = 'stringof(((proc_t *)(args[1]->pr_addr))' +
	     '->p_zone->zone_name)';
	var zones = metric.is_zones === undefined ? null : metric.is_zones;
	var transforms = {
		runtime: '(timestamp - self->ts)',
		pid: 'lltostr(curpsinfo->pr_pid)',
		execname: 'curpsinfo->pr_fname',
		leavereason: '(curlwpsinfo->pr_state == SRUN ? "runnable" : ' +
		    'curlwpsinfo->pr_state == SZOMB ? "exited" : ' +
		    'curlwpsinfo->pr_state == SSTOP ? "stopped" : ' +
		    'curlwpsinfo->pr_state == SIDL ? "in proc creation" : ' +
		    'curlwpsinfo->pr_state == SONPROC ? "on-cpu" : ' +
		    'curlwpsinfo->pr_state == SWAIT ? "waiting to be ' +
		    'runnable" :' +
		    'curlwpsinfo->pr_stype == SOBJ_NONE ? "sleeping" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_MUTEX ? "kernel mutex" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_RWLOCK ? "kernel ' +
		    'read/write lock" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_CV ? "kernel condition ' +
		    'variable" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_SEMA ? "kernel ' +
		    'semaphore" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_USER ? "user synch ' +
		    'object" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_USER_PI ? ' +
		    '"user sync object with priority inheritence" : ' +
		    '"shuttle synchronization object")',
		leavepid: insdCpuThrSeeField(nextzone,
		    'lltostr(args[1]->pr_pid)', zones,
		    'other customer pid'),
		leaveexec: insdCpuThrSeeField(nextzone,
		    'args[1]->pr_fname', zones,
		    'other customer application'),
		zonename: 'zonename',
		leavezone: insdCpuThrSeeField(nextzone,
		    nextzone, zones, 'other customer zone')
	};

	predicates = [];

	hasPred = mod_capred.caPredNonTrivial(pred);
	if (hasPred && mod_capred.caPredContainsField('runtime', pred))
		traceRuntime = true;

	if (zones) {
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		switch (decomps[ii]) {
		case 'runtime':
			traceRuntime = true;
			aggRuntime = true;
			break;
		case 'leavepid':
		case 'leaveexec':
		case 'leavezone':
			onlySrun = true;
			/*jsl:fallthru*/
		default:
			indexes.push(transforms[decomps[ii]]);
			break;
		}
	}

	ASSERT.ok(indexes.length < 2);

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = aggRuntime ? [] : 0;
	}

	if (traceRuntime) {
		script += 'sched:::on-cpu\n';
		script += '{\n';
		script += '\tself->ts = timestamp;\n';
		script += '}\n\n';

		predicates.push('self->ts != NULL');
	}

	if (aggRuntime)
		action = insdLlquantize(transforms['runtime']) + ';';
	else
		action = 'count();';

	if (hasPred) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields(transforms, pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}

	/*
	 * XXX We don't want to include that we're giving up the CPU to say
	 * cloud analytics. To keep those zones straight and separated from
	 * customer zones, we're going to add a predicate that as general as we
	 * can, but still encodes implementation details. This is ugly, but
	 * there isn't really a better way currently.
	 */
	if (onlySrun) {
		predicates.push('curlwpsinfo->pr_state == SRUN');
		predicates.push(caSprintf('strlen(%s) == 36', nextzone));
	}

	predicates.push('(curlwpsinfo->pr_flag & PR_IDLE) == 0');

	script += 'sched:::off-cpu\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);
	script += '}\n\n';

	/* Always clear ts */
	script += 'sched:::off-cpu\n';
	script += '{\n';
	script += '\tself->ts = 0;\n';
	script += '}\n\n';

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero,
	    action != 'count();'));
}

/*
 * Generally all of the fop_* calls that we are interested in have the same
 * interface for fbt:::entry where the first argument is a vnode_t *. However,
 * fop_open is unique in that it takes a vnode_t **.
 */
function insdLogFSIO(metric)
{
	var script = '';
	var pred = metric.is_predicate;
	var decomps = metric.is_decomposition;
	var before, ii, zones, predicates, indexes, index, zero, action;
	var hasPred, fields, key;
	var aggLatency = false;
	var setFilename = '(((vnode_t *)arg0)->v_path == NULL ? "<unknown>" ' +
	    ': cleanpath(((vnode_t *)arg0)->v_path))';
	var setFstype = 'stringof(((vnode_t *)arg0)->v_op->vnop_name)';
	var setOpenFilename = '(*((vnode_t**)arg0))->v_path == NULL ? ' +
	    '"<unknown>" : cleanpath((*((vnode_t**)arg0))->v_path)';
	var setOpenFstype = 'stringof((*((vnode_t**)arg0))->v_op->vnop_name)';
	/* All probes sans fop_open */
	var probelist = [ 'fop_read', 'fop_write', 'fop_ioctl', 'fop_access',
	    'fop_getattr', 'fop_setattr', 'fop_lookup', 'fop_create',
	    'fop_remove', 'fop_link', 'fop_rename', 'fop_mkdir', 'fop_rmdir',
	    'fop_readdir', 'fop_symlink', 'fop_readlink', 'fop_fsync',
	    'fop_getpage', 'fop_putpage', 'fop_map' ];
	var transforms = {
		execname: 'stringof(curpsinfo->pr_fname)',
		pid: 'lltostr(curpsinfo->pr_pid)',
		zonename: 'zonename',
		filename: 'self->filename',
		operation: 'probefunc == "fop_read" ? "read" : ' +
		    'probefunc == "fop_write" ? "write" : ' +
		    'probefunc == "fop_open" ? "open" : ' +
		    'probefunc == "fop_close" ? "close" : ' +
		    'probefunc == "fop_ioctl" ? "ioctl" : ' +
		    'probefunc == "fop_getattr" ? "getattr" : ' +
		    'probefunc == "fop_setattr" ? "setattr" : ' +
		    'probefunc == "fop_access" ? "access" : ' +
		    'probefunc == "fop_lookup" ? "lookup" : ' +
		    'probefunc == "fop_create" ? "create" : ' +
		    'probefunc == "fop_remove" ? "remove" : ' +
		    'probefunc == "fop_link" ? "link" : ' +
		    'probefunc == "fop_rename" ? "rename" : ' +
		    'probefunc == "fop_mkdir" ? "mkdir" : ' +
		    'probefunc == "fop_rmdir" ? "rmdir" : ' +
		    'probefunc == "fop_readdir" ? "readdir" : ' +
		    'probefunc == "fop_symlink" ? "symlink" : ' +
		    'probefunc == "fop_readlink" ? "readlink" : ' +
		    'probefunc == "fop_fsync" ? "fsync" : ' +
		    'probefunc == "fop_getpage" ? "getpage" : ' +
		    'probefunc == "fop_putpage" ? "putpage" : ' +
		    'probefunc == "fop_map" ? "mmap" : ' +
		    '"<unknown>"',
		fstype: 'self->fstype',
		latency: '(timestamp - self->ts)'
	};

	var fsign = [ 'sockfs', 'doorfs', 'sharefs sharetab file', 'mntfs',
	    'fifofs', 'swapfs', 'specfs' ];

	predicates = [];
	before = {};
	/* We must always get the fstype to ensure we don't catch sockfs */
	before['fstype'] = true;
	hasPred = mod_capred.caPredNonTrivial(pred);

	if (metric.is_zones) {
		zones = metric.is_zones.map(function (elt) {
			return ('zonename == "' + elt + '"');
		});

		predicates.push(zones.join(' ||\n'));
	}

	indexes = [];
	for (ii = 0; ii < decomps.length; ii++) {
		switch (decomps[ii]) {
		case 'latency':
			aggLatency = true;
			before['latency'] = true;
			break;
		case 'filename':
			before['filename'] = true;
			indexes.push(transforms[decomps[ii]]);
			break;
		case 'fstype':
			before['fstype'] = true;
			indexes.push(transforms[decomps[ii]]);
			break;
		default:
			indexes.push(transforms[decomps[ii]]);
			break;
		}
	}

	fields = mod_capred.caPredFields(pred);
	for (ii = 0; ii < fields.length; ii++) {
		switch (fields[ii]) {
		case 'latency':
			before['latency'] = true;
			break;
		case 'filename':
			before['filename'] = true;
			break;
		case 'fstype':
			before['fstype'] = true;
			break;
		default:
			break;
		}
	}

	ASSERT.ok(indexes.length < 2);

	if (indexes.length > 0) {
		index = '[' + indexes.join(',') + ']';
		zero = {};
	} else {
		index = '';
		zero = aggLatency ? [] : 0;
	}

	if (!caIsEmpty(before)) {
		script += probelist.map(function (x) {
			return (caSprintf('fbt::%s:entry', x));
		}).join(',\n') + '\n';
		script += caSprintf('/%s != "sockfs"/\n', transforms['fstype']);
		script += '{\n';
		for (key in before) {
			switch (key) {
			case 'latency':
				script += '\tself->ts = timestamp;\n';
				break;
			case 'filename':
				script += caSprintf('\tself->filename = %s;\n',
				    setFilename);
				break;
			case 'fstype':
				script += caSprintf('\tself->fstype = %s;\n',
				    setFstype);
				break;
			default:
				ASSERT.ok(false, 'programmer error');
				break;
			}
		}
		script += '}\n\n';
		script += 'fbt::fop_open:entry\n';
		script += caSprintf('/%s != "sockfs"/\n', transforms['fstype']);
		script += '{\n';
		for (key in before) {
			switch (key) {
			case 'latency':
				script += '\tself->ts = timestamp;\n';
				break;
			case 'filename':
				script += caSprintf('\tself->filename = %s;\n',
				    setOpenFilename);
				break;
			case 'fstype':
				script += caSprintf('\tself->fstype = %s;\n',
				    setOpenFstype);
				break;
			default:
				ASSERT.ok(false, 'programmer error');
				break;
			}
		}
		script += '}\n\n';
	}

	if (aggLatency) {
		action = insdLlquantize(transforms['latency']) + ';';
		predicates.push('self->ts');
	} else {
		action = 'count();';
	}

	if (hasPred) {
		pred = mod_ca.caDeepCopy(metric.is_predicate);
		mod_capred.caPredReplaceFields(transforms, pred);
		predicates.push(mod_capred.caPredPrint(pred));
	}

	for (ii = 0; ii < fsign.length; ii++)
		predicates.push(caSprintf('%s != "%s"\n', transforms['fstype'],
		    fsign[ii]));

	/*
	 * The interface for the fop_open return probe is the same as the
	 * others, so we can push it on now along with the others
	 */
	probelist.push('fop_open');

	script += probelist.map(function (x) {
			return (caSprintf('fbt::%s:return', x));
		}).join(',\n') + '\n';
	script += insdMakePredicate(predicates);
	script += '{\n';
	script += mod_ca.caSprintf('\t@%s = %s\n', index, action);
	script += '}\n\n';

	script += probelist.map(function (x) {
			return (caSprintf('fbt::%s:return', x));
		}).join(',\n') + '\n';
	script += '{\n';
	script += '\tself->ts = 0;\n';
	script += '\tself->filename = 0;\n';
	script += '\tself->fstype = 0;\n';
	script += '}\n\n';

	return (new insDTraceVectorMetric(script, indexes.length > 0, zero,
	    action != 'count();'));

}

function insDTraceMetric(prog)
{
	this.cad_prog = prog;
}


insDTraceMetric.prototype.instrument = function (callback)
{
	var ii;
	var sep = '----------------------------------------';

	/*
	 * Only log the script on the first time through here.
	 */
	if (this.cad_dtr === undefined)
		insd_log.dbg('\n%s\n%s%s', sep, this.cad_prog, sep);

	this.cad_dtr = new mod_dtrace.Consumer();
	this.cad_dtr.setopt('bufsize', insd_dt_bufsize);
	this.cad_dtr.setopt('cleanrate', insd_dt_cleanrate);
	this.cad_dtr.setopt('dynvarsize', insd_dt_dynvarsize);
	this.cad_dtr.setopt('strsize', insd_dt_strsize);
	this.cad_dtr.setopt('zdefs');
	for (ii = 0; ii < insd_dt_libpath.length; ii++)
		this.cad_dtr.setopt('libdir', insd_dt_libpath[ii]);

	try {
		this.cad_dtr.strcompile(this.cad_prog);
		this.cad_dtr.go();
		insd_nenablings++;

		if (callback)
			callback();
	} catch (ex) {
		insd_log.error('instrumentation failed: %r', ex);
		this.cad_dtr = null;
		if (callback)
			callback(ex);
	}
};

insDTraceMetric.prototype.deinstrument = function (callback)
{
	--insd_nenablings;
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
		    'reading aggregation: %r', ex);
		this.instrument();
		return (undefined);
	}

	return (this.reduce(agg));
};

function insDTraceVectorMetric(prog, hasdecomps, zero, hasdists)
{
	this.cadv_decomps = hasdecomps;
	this.cadv_zero = zero;
	if (!hasdecomps && zero === 0)
		this.cadv_adder = mod_caagg.caAddScalars;
	else if (!hasdecomps)
		this.cadv_adder = mod_caagg.caAddDistributions;
	else if (!hasdists)
		this.cadv_adder = function (lhs, rhs) {
			return (mod_caagg.caAddDecompositions(lhs, rhs));
		};
	else
		this.cadv_adder = function (lhs, rhs) {
			return (mod_caagg.caAddDecompositions(lhs, rhs,
			    mod_caagg.caAddDistributions));
		};

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

/*
 * This object is designed to hide the fact that we may be doing multiple
 * enablings under the hood. It itself has an array of insDTraceMetrics and
 * presents itself as an insDTraceMetric, though it is not an instance of one.
 *
 *	progs		An array of insDTraceMetrics
 */
function insDTraceMetricArray(progs)
{
	ASSERT.ok(progs !== undefined, 'missing progs arg');

	ASSERT.ok(progs instanceof Array, 'progs must be an array');

	ASSERT.ok(progs.length >= 1, 'progs must be an array with at least ' +
	    'one entry');

	this.cad_progs = progs;
}

insDTraceMetricArray.prototype.instrument = function (callback)
{
	var ii = 0;
	var funcs = this.cad_progs.map(function (x) {
		return (caWrapMethod(x, x.instrument));
	});

	mod_ca.caRunParallel(funcs, function (res) {
		if (res.nerrors === 0) {
			callback();
			return;
		}

		for (ii = 0; ii < res.length; ii++) {
			if ('result' in res.results[ii])
				this.cad_progs[ii].deinstrument();
		}

		var foo = new caError(ECA_REMOTE,
		    res.results[res.errlocs[0]]['error'],
		    'failed to enable %d DTrace enablings; saving first error',
		    res.nerrors);
		callback(foo);
	});
};

insDTraceMetricArray.prototype.deinstrument = function (callback)
{
	var funcs = this.cad_progs.map(function (x) {
		return (caWrapMethod(x, x.deinstrument));
	});

	mod_ca.caRunParallel(funcs, function (res) {
		if (res.nerrors === 0) {
			callback();
			return;
		}

		callback(new caError(ECA_REMOTE, res.results[res.errlocs[0]],
		    'failed to disable %d DTrace enablings; saving first error',
		    res.nerrors));
	});
};

/*
 * It is rather important that we make a copy of zero here. When we use
 * caAddDecompositions as our adder it modifies the left hand side of our value.
 * If we don't copy zero, the initial value will end up getting modified. This
 * can lead to an ever-increasing value.
 */
insDTraceMetricArray.prototype.value = function ()
{
	var adder = this.cad_progs[0].cadv_adder;
	var zero = caDeepCopy(this.cad_progs[0].cadv_zero);
	var data = this.cad_progs.map(function (x) {
		var val = x.value();
		if (val === undefined)
			return (x.cadv_zero);
		else
			return (val);
	});

	return (data.reduce(adder, zero));
};
