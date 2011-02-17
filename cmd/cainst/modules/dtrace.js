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
var insd_dlibpath = [];		/* DTrace library Path (-L) */
var insd_nenablings = 0;	/* number of active enablings */

if (process.env['DTRACE_LIBPATH']) {
	insd_dlibpath = process.env['DTRACE_LIBPATH'].split(':');
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

	ins.registerModule({ name: 'node', label: 'Node.js' });
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
		addr: { label: 'remote host', type: mod_ca.ca_type_string },
		port: { label: 'remote port', type: mod_ca.ca_type_string },
		size: { label: 'size', type: mod_ca.ca_type_number },
		buffered: {
		    label: 'buffered data',
		    type: mod_ca.ca_type_number
		}
	    },
	    metric: insdNodeSocket
	});

};

function insdStatus()
{
	var ret = {};
	ret['dtrace_libpath'] = insd_dlibpath;
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

	/*
	 * We divide latency by the same amount that we do during the quantize,
	 * so that that the values input by the user will be in the same unit as
	 * when visualized. Hopefully this will not be needed once we have some
	 * kind of equantize.
	 */
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
	    addr: arg0addr,
	    port: 'lltostr( ' + arg0port + ')',
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
	this.cad_dtr.setopt('zdefs');
	for (ii = 0; ii < insd_dlibpath.length; ii++)
		this.cad_dtr.setopt('libdir', insd_dlibpath[ii]);

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
		this.cadv_adder = mod_caagg.caAddDecompositions;
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

insDTraceMetricArray.prototype.value = function ()
{
	var adder = this.cad_progs[0].cadv_adder;
	var data = this.cad_progs.map(function (x) {
		var val = x.value();
		if (val === undefined)
			return (x.cadv_zero);
		else
			return (val);
	});
	return (data.reduce(adder));
};
