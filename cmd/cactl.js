/*
 * cactl: poke and prod components of a Cloud Analytics instance
 */

var mod_assert = require('assert');
var mod_sys = require('sys');

var mod_ca = require('../lib/ca/ca-common');
var mod_cap = require('../lib/ca/ca-amqp-cap');
var mod_capred = require('../lib/ca/ca-pred');
var mod_log = require('../lib/ca/ca-log');
var mod_metric = require('../lib/ca/ca-metric');

var cc_timeout_msec = 3 * 1000;		/* timeout after 3s */
var cc_argv;				/* arguments */
var cc_optind;				/* current argument */
var cc_verbose = false;			/* extended "status" message */
var cc_debug = false;			/* debug mode */
var cc_cmdswitch = {};			/* dispatch cmds */
var cc_cap;				/* cap wrapper */
var cc_toid;				/* timeout handle */
var cc_cmd;				/* command sent */
var cc_start;				/* time cmd was sent */
var cc_list;				/* command was "stash list" */
var cc_arg0 = process.argv[1];
var cc_help = [
    'usage: cactl [-d] <subcommand> [...]',
    '',
    '    Examine and manipulate the Cloud Analytics service.',
    '',
    '    SUBCOMMANDS',
    '',
    '        abort <routekey>',
    '            Panic remote service (use with caution)',
    '',
    '        log <routekey> <msg>',
    '            Insert message into remote service log',
    '',
    '        ping <routekey>',
    '            Check connectivity with remote service',
    '',
    '        stash del <bucket>',
    '            Delete stash bucket "bucket"',
    '',
    '        stash get <bucket>',
    '            Retrieve contents of stash bucket "bucket"',
    '',
    '        stash list',
    '            Show list of all stash buckets',
    '',
    '        stash put <bucket> <contents> [<metadata>]',
    '            Save contents into stash bucket "bucket"',
    '',
    '        status <routekey>',
    '            Retrieve details about a remote service',
    '',
    '        summary',
    '            Summarize all service status',
    '',
    '    ARGUMENTS',
    '',
    '        The above commands take one or more of these arguments:',
    '',
    '        <bucket>                 stash bucket identifier',
    '',
    '        <contents>, <metadata>   desired stash bucket contents, metadata',
    '',
    '        <msg>                    message to insert into remote log',
    '',
    '        <routekey>               routing key for exactly one service',
    '',
    '    Commands that infer routing keys (like "stash" and "summary") ',
    '    respect the value of CA_AMQP_PREFIX in the environment.  Production ',
    '    deployments generally leave this value unset, but dev environments ',
    '    frequently use this to maintain separate CA service deployments.',
    '',
    '    OPTIONS',
    '',
    '        -d                       dump sent/received AMQP traffic',
    '                                 (deprecated; use amqpsnoop)'
].join('\n');

function printf()
{
	var text = mod_ca.caSprintf.apply(null, arguments);
	process.stdout.write(text);
}

function main()
{
	var sysinfo, queuename, loglevel, log, capconf;

	cc_argv = process.argv;
	cc_optind = 2;

	if (cc_argv[cc_optind] == '-d') {
		cc_debug = true;
		loglevel = mod_log.caLog.DBG;
		cc_optind++;
	} else {
		loglevel = mod_log.caLog.INFO;
	}

	if (cc_argv.length - cc_optind < 1)
		usage();

	sysinfo = mod_ca.caSysinfo('cactl', '0.1');
	queuename = mod_cap.ca_amqp_key_base_tool + sysinfo.ca_hostname +
	    '.' + process.pid;
	log = new mod_log.caLog({ out: process.stdout, level: loglevel });

	capconf = {
	    log: log,
	    queue: queuename,
	    sysinfo: sysinfo,
	    retry_limit: 0
	};

	if (cc_debug)
		capconf['dbglog'] = log;

	cc_cap = new mod_cap.capAmqpCap(capconf);
	cc_cap.on('msg-ack-abort', ccAckAbort);
	cc_cap.on('msg-ack-ping', ccAckPing);
	cc_cap.on('msg-ack-data_get', ccAckDataGet);
	cc_cap.on('msg-ack-data_put', ccAckDataPut);
	cc_cap.on('msg-ack-data_delete', ccAckDataDel);
	cc_cap.on('connected', ccRunCmd);
	cc_cap.start();
}

function usage(msg)
{
	if (msg)
		printf('%s: %s\n', cc_arg0, msg);
	printf('%s\n', cc_help);
	process.exit(2);
}

function die()
{
	var text = mod_ca.caSprintf.apply(null, arguments);
	printf('%s: fatal error: %s\n', cc_arg0, text);
	process.exit(1);
}

function shutdown()
{
	cc_cap.stop();
}

function ccTimeout()
{
	printf('Timed out.\n');
	process.exit(3);
}

function ccRunCmd()
{
	cc_cmd = cc_argv[cc_optind++];

	cc_verbose = false;
	cc_argv.forEach(function (arg) {
		if (arg == '-v')
			cc_verbose = true;
	});

	if (!(cc_cmd in cc_cmdswitch))
		usage('unrecognized command: ' + cc_cmd);

	cc_start = new Date();
	cc_cmdswitch[cc_cmd](cc_cmd);
}

function ccRunCmdCmd(cmd)
{
	var destkey, msg;

	if (cc_argv.length <= cc_optind)
		usage('missing routing key');

	destkey = cc_argv[cc_optind++];

	msg = {};
	msg.ca_type = 'cmd';
	msg.ca_subtype = cmd;
	msg.ca_id = 1;
	cc_cap.send(destkey, msg);
	cc_toid = setTimeout(ccTimeout, cc_timeout_msec);
}

function ccRunCmdLog()
{
	var destkey, msg;

	if (cc_argv.length <= cc_optind)
		usage('missing routing key');

	destkey = cc_argv[cc_optind++];

	if (cc_argv.length <= cc_optind)
		usage('missing log message');

	msg = {};
	msg.ca_type = 'notify';
	msg.ca_subtype = 'log';
	msg.l_message = cc_argv[cc_optind++];
	cc_cap.send(destkey, msg);
	shutdown();
}

function ccRunCmdStash()
{
	var msg, subcmd, bucket;

	if (cc_argv.length <= cc_optind)
		usage('missing stash subcommand');

	subcmd = cc_argv[cc_optind++];
	msg = {};
	msg.ca_id = 1;
	msg.ca_type = 'cmd';

	switch (subcmd) {
	case 'list':
		cc_list = true;
		/*jsl:fallthru*/
	case 'get':
		msg.ca_subtype = 'data_get';
		break;

	case 'put':
		msg.ca_subtype = 'data_put';
		break;

	case 'del':
	case 'delete':
		msg.ca_subtype = 'data_delete';
		break;

	default:
		usage('invalid stash subcommand');
		break;
	}

	if (subcmd == 'list') {
		bucket = '.contents';
	} else if (cc_argv.length > cc_optind) {
		bucket = cc_argv[cc_optind++];
	} else {
		usage('missing stash bucket');
	}

	cc_cmd = msg.ca_subtype;

	if (subcmd != 'put') {
		msg.p_requests = [ { bucket: bucket } ];
		cc_cap.send(mod_cap.ca_amqp_key_stash, msg);
		cc_toid = setTimeout(ccTimeout, cc_timeout_msec);
		return;
	}

	if (cc_argv.length <= cc_optind)
		usage('missing stash contents');

	msg.p_requests = [ {
	    bucket: bucket,
	    data: cc_argv[cc_optind++],
	    metadata: cc_argv.length > cc_optind ?
	        JSON.parse(cc_argv[cc_optind++]) : {}
	} ];

	cc_cap.send(mod_cap.ca_amqp_key_stash, msg);
	cc_toid = setTimeout(ccTimeout, cc_timeout_msec);
}

function ccCheckMsg(msg, hidelatency)
{
	var end = new Date();
	var millis = end.getTime() - cc_start.getTime();

	if (msg.ca_subtype !== cc_cmd)
		die('response message had wrong subtype: %s', msg.ca_subtype);

	if (msg.ca_id !== 1)
		die('response message had wrong id: %s', msg.ca_id);

	if (!hidelatency)
		printf('%-12s %d ms\n', 'Latency:', millis);

	clearTimeout(cc_toid);
}

function ccAckAbort(msg)
{
	ccCheckMsg(msg);
	printf('%-12s %s\n', 'Hostname:', msg.ca_hostname);
	printf('%-12s %s\n', 'Route key:', msg.ca_source);
	printf('%-12s %s/%s\n', 'Agent:', msg.ca_agent_name,
	    msg.ca_agent_version);
	printf('%-12s %s %s %s\n', 'OS:', msg.ca_os_name,
	    msg.ca_os_release, msg.ca_os_revision);
	printf('abort request %s\n', msg.a_ok ? 'accepted': 'rejected');
	shutdown();
}

function ccAckPing(msg)
{
	ccCheckMsg(msg);
	printf('%-12s %s\n', 'Hostname:', msg.ca_hostname);
	printf('%-12s %s\n', 'Route key:', msg.ca_source);
	printf('%-12s %s/%s\n', 'Agent:', msg.ca_agent_name,
	    msg.ca_agent_version);
	printf('%-12s %s %s %s\n', 'OS:', msg.ca_os_name,
	    msg.ca_os_release, msg.ca_os_revision);
	shutdown();
}

function ccAckDataPut(msg)
{
	var result;

	ccCheckMsg(msg);

	printf('%-12s %s\n', 'Hostname:', msg.ca_hostname);
	printf('%-12s %s\n', 'Route key:', msg.ca_source);
	printf('%-12s %s/%s\n', 'Agent:', msg.ca_agent_name,
	    msg.ca_agent_version);
	printf('%-12s %s %s %s\n', 'OS:', msg.ca_os_name,
	    msg.ca_os_release, msg.ca_os_revision);

	result = msg.p_results[0];

	if ('error' in result) {
		printf('ERROR saving data: %s\n',
		    result['error']['message']);
		process.exit(1);
	}

	printf('saved data\n');
	shutdown();
}

function ccAckDataDel(msg)
{
	var result;

	ccCheckMsg(msg);

	printf('%-12s %s\n', 'Hostname:', msg.ca_hostname);
	printf('%-12s %s\n', 'Route key:', msg.ca_source);
	printf('%-12s %s/%s\n', 'Agent:', msg.ca_agent_name,
	    msg.ca_agent_version);
	printf('%-12s %s %s %s\n', 'OS:', msg.ca_os_name,
	    msg.ca_os_release, msg.ca_os_revision);

	result = msg.p_results[0];

	if ('error' in result) {
		printf('ERROR deleting bucket: %s\n',
		    result['error']['message']);
		process.exit(1);
	}

	printf('deleted bucket\n');
	shutdown();
}

function ccAckDataGet(msg)
{
	var result, metadata, buckets, ii;

	ccCheckMsg(msg, !cc_list);

	if (cc_list) {
		printf('%-12s %s\n', 'Hostname:', msg.ca_hostname);
		printf('%-12s %s\n', 'Route key:', msg.ca_source);
		printf('%-12s %s/%s\n', 'Agent:', msg.ca_agent_name,
		    msg.ca_agent_version);
		printf('%-12s %s %s %s\n', 'OS:', msg.ca_os_name,
		    msg.ca_os_release, msg.ca_os_revision);
	}

	result = msg.p_results[0];

	if ('error' in result) {
		printf('ERROR retrieving data: %s\n',
		    result['error']['message']);
		process.exit(1);
	}

	result = result['result'];

	if (!cc_list) {
		printf('%s\n', result['data']);
		shutdown();
		return;
	}

	metadata = JSON.parse(result['data']);
	buckets = Object.keys(metadata).sort();

	printf('Buckets:\n');
	for (ii = 0; ii < buckets.length; ii++)
		printf('%-20s  %j\n', buckets[ii], metadata[buckets[ii]]);
	printf('%d buckets.\n', buckets.length);

	shutdown();
}

/*
 * The rest of this file deals with the general commands that fetch and process
 * service status messages.  For each of these commands, the first step is to
 * invoke ccFetchStatus to retrieve the status of everything in the system, then
 * we invoke ccSumSummarize() to print the results.
 */
function ccRunCmdStatus()
{
	var destkey;

	if (cc_argv.length <= cc_optind)
		usage('missing routing key');

	destkey = cc_argv[cc_optind++];
	cc_verbose = true;
	ccFetchStatus([ destkey ], false, ccSumSummarize);
}

function ccRunCmdSummarize()
{
	ccFetchStatus([ mod_cap.ca_amqp_key_all ], true, ccSumSummarize);
}

/*
 * Send a status request to each of the specified routing keys and invoke
 * "callback" when all of the requests have completed.  In general, it's hard to
 * know when we've actually received all the responses we're going to get
 * because we don't know how many services will match a given routing key.  We
 * provide two modes: if "wait" is false, we invoke "callback" as soon as we
 * receive the first response.  If "wait" is true, we invoke "callback" only
 * after we've received a response from a configuration service, a stash
 * service, *and* all of the services that the config service knows about.  In
 * both cases, we may return with partial results after a timeout has elapsed.
 */
function ccFetchStatus(routekeys, wait, callback)
{
	var svcs, start, timed_out, checkdone, sendmsg, pending;
	var havestash = false;

	start = new Date().getTime();
	timed_out = false;
	svcs = {};

	cc_cap.on('msg-ack-status', function (msg) {
		var rkey = msg.ca_source;
		var key;

		if (timed_out) {
			printf('warning: ignoring status from %s after ' +
			    'timeout\n', rkey);
			return;
		}

		if (rkey in svcs) {
			printf('warning: ignoring dup status from %s\n', rkey);
			return;
		}

		svcs[rkey] = {
		    status: msg,
		    latency: new Date().getTime() - start
		};

		if (msg.s_component == 'stash')
			havestash = true;

		if (msg.s_component != 'config') {
			if (pending !== undefined)
				delete (pending[rkey]);

			checkdone();
			return;
		}

		pending = {};

		for (key in msg.s_status.cfg_instrumenters) {
			rkey = msg.s_status.cfg_instrumenters[key].routekey;
			if (rkey in svcs)
				continue;
			pending[rkey] = true;
		}

		for (key in msg.s_status.cfg_aggregators) {
			rkey = msg.s_status.cfg_aggregators[key].routekey;
			if (rkey in svcs)
				continue;
			pending[rkey] = true;
		}

		checkdone();
		return;
	});

	checkdone = function () {
		if (wait && pending === undefined) {
			if (timed_out)
				return (callback(new caError(ECA_TIMEDOUT,
				    null, 'timed out waiting for configsvc'),
				    svcs));

			return (undefined);
		}

		if (!wait || (caIsEmpty(pending) && havestash)) {
			clearTimeout(cc_toid);
			timed_out = true;
			return (callback(null, svcs));
		}

		if (timed_out)
			return (callback(new caError(ECA_TIMEDOUT,
			    null, 'timed out waiting for known services: %s',
			    Object.keys(pending).join(', ')),
			    svcs));

		return (undefined);
	};

	cc_toid = setTimeout(function () {
		mod_assert.ok(!timed_out);
		timed_out = true;
		checkdone();
	}, cc_timeout_msec);

	sendmsg = {};
	sendmsg.ca_type = 'cmd';
	sendmsg.ca_subtype = 'status';
	sendmsg.ca_id = 1;

	routekeys.forEach(function (key) { cc_cap.send(key, sendmsg); });
}

/*
 * Given an object mapping routing key -> (status, latency) tuple (as provided
 * by ccFetchStatus), inspect each entry's component type and return an object
 * mapping each of the four main CA component types (aggregator, config,
 * instrumenter, stash) to an array of the routing keys having that type.
 */
function ccExtractComponents(svcs)
{
	var types, host, msg, type;

	types = {
	    'aggregator': [],
	    'config': [],
	    'instrumenter': [],
	    'stash': []
	};

	for (host in svcs) {
		msg = svcs[host];
		type = msg.status.s_component;
		mod_assert.ok(type in types,
		    caSprintf('%s not in %j', type, types));
		types[type].push(host);
	}

	for (type in types)
		types[type].sort();

	return (types);
}

/*
 * Given a component routekey, return an abbreviated name no longer than the
 * specified length.
 */
function ccAbbrevRoutekey(routekey, length)
{
	/*
	 * Routing keys generally have the form:
	 *
	 *    [pfx]ca.<component>.<hostname>[-<suffix>]
	 *
	 * where:
	 *
	 *    o 'pfx' is completely optional and used for dev and testing
	 *    o <component> is one of a few known component types
	 *    o <hostname> can be arbitrarily long
	 *    o '-<suffix>' is only used for aggregators
	 *
	 * The hostname is the part we'd prefer to abbreviate.  Rather than
	 * parse the entire routing key (which would be both painful and
	 * brittle), we just identify the <component> section and replace as
	 * many characters as necessary following that with "...".  That's
	 * almost true: we actually keep the first 'overlap' (5) characters of
	 * the hostname since people often recognize these better than the
	 * characters at the end.
	 */
	var components = [ 'config', 'aggregator', 'instrumenter', 'stash' ];
	var needchop = routekey.length - length;
	var overlap = 5;
	var ckey, idx, prefix, suffix, ii;

	if (needchop <= 0)
		return (routekey);

	/* Chop an additional three for the "..." that we're going to add. */
	needchop += '...'.length;

	for (ii = 0; ii < components.length; ii++) {
		ckey = 'ca.' + components[ii] + '.';
		idx = routekey.indexOf(ckey);
		if (idx != -1) {
			prefix = routekey.substr(0, idx + ckey.length +
			    overlap);
			suffix = routekey.substr(idx + ckey.length + needchop +
			    overlap);
			break;
		}
	}

	if (prefix === undefined)
		/* ignore whatever we didn't understand. */
		return (routekey);

	return (prefix + '...' + suffix);
}

/*
 * Print a one-line summary of a CA service.
 */
function ccSumSvcSummary(svcs, rkey)
{
	var svc, msg;

	if (!rkey) {
		printf('%-50s  %-6s  %s\n', 'SERVICES', 'PING', 'UPTIME');
		return;
	}

	svc = svcs[rkey];
	msg = svc.status;
	printf('%-50s  %4dms  %s\n',
	    ccAbbrevRoutekey(msg.ca_source, 50), svc.latency,
	    msg.s_status && msg.s_status.uptime ?
	    mod_ca.caFormatDuration(msg.s_status.uptime) : 'unknown');
}

/*
 * Print a summary of an aggregator's state.
 */
function ccSumSvcAggr(svcs, verbose, rkey)
{
	var msg, fqid, instn;

	if (!rkey) {
		printf('%-62s  %-5s  %8s\n', 'AGGREGATORS', 'PORT',
		    'R#INSTNS');
		return;
	}

	msg = svcs[rkey].status;
	printf('%-62s  %5d  %8d\n', msg.ca_source,
	    msg.s_status.agg_http_port, msg.s_status.agg_ninsts);

	if (!verbose)
		return;

	if (caIsEmpty(msg.s_status.agg_insts))
		return;

	printf('    %-45s  %-6s  %-3s  %-5s  %-3s\n',
	    'INSTNID', 'RETAIN', 'PST', 'GRAN', 'DIM');
	for (fqid in msg.s_status.agg_insts) {
		instn = msg.s_status.agg_insts[fqid];
		printf('    %-45s  %5ds  %3s  %4ds  %3d\n',
		    fqid, instn['inst']['retention-time'],
		    instn['inst']['persist-data'] ? 'Y' : 'N',
		    instn['inst']['granularity'],
		    instn['inst']['value-dimension']);
	}
}

/*
 * Print a summary of an instrumenter's state.
 */
function ccSumSvcInstr(svcs, verbose, rkey)
{
	var msg, ii, metadata;

	msg = svcs[rkey].status;
	printf('%-62s  %-4s   %8s\n', 'INSTRUMENTERS', 'NMET', 'R#INSTNS');
	printf('%-62s  %4d   %8d\n', msg.ca_source,
	    msg.s_metadata['metrics'].length,
	    msg.s_status.instrumentations.length);

	if (!verbose)
		return;

	for (ii = 0; ii < msg.s_status.instrumentations.length; ii++)
		printf('    %-45s\n',
		    msg.s_status.instrumentations[ii].s_inst_id);

	if (cc_cmd == 'status') {
		printf('\nMETRICS\n');
		metadata = new mod_metric.caMetricMetadata();
		metadata.addFromHost(msg.s_metadata, 'remote host');
		metadata.report(process.stdout, true);
	}
}

/*
 * Print a summary of the configsvc's instrumentations.
 */
function ccSumCfgInstns(svcs, verbose, rkey)
{
	var instns, entries, instn, arity, idx, ii;

	printf('\n%-45s  %-20s  %-10s\n', 'INSTRUMENTATIONS',
	    'MOD.STAT', 'DIM/ARITY');

	instns = svcs[rkey].status.s_status.cfg_insts;
	entries = Object.keys(instns).sort();
	for (ii = 0; ii < entries.length; ii++) {
		instn = instns[entries[ii]];

		arity = instn['value-arity'];
		if ((idx = arity.indexOf('-decomposition')) != -1)
			arity = arity.substring(0, idx);

		printf('%-45s  %-20s  %d/%s\n', entries[ii],
		    instn['module'] + '.' + instn['stat'],
		    instn['value-dimension'], arity);

		if (!verbose)
			continue;

		printf('    %-11s %s\n', 'aggregator:',
		    instn['aggregator']);

		if (!caIsEmpty(instn['predicate']))
			printf('    %-11s %s\n', 'predicate:',
			    mod_capred.caPredPrint(instn['predicate']));

		if (instn['decomposition'].length !== 0)
			printf('    %-11s %j\n', 'decomps:',
			    instn['decomposition']);
	}
}

function ccSumSummarize(err, svcs)
{
	var bytype, msg;

	if (err) {
		if (err.code() != ECA_TIMEDOUT)
			die(err.toString());

		printf('%s\n', err);
	}

	bytype = ccExtractComponents(svcs);
	if (bytype['config'].length > 1)
		printf('warning: expected 1 config service, but found %d\n',
		    bytype['config'].length);

	if (bytype['stash'].length > 1)
		printf('warning: expected 1 stash, but found %d\n',
		    bytype['stash'].length);

	bytype['config'].forEach(function (host) {
		msg = svcs[host].status;

		printf('CONFIG %s\n', host);
		printf('    %-9s %dms\n', 'response:',
		    msg.s_status['request_latency']);
		printf('    %-9s %d\n', '# aggrs:',
		    Object.keys(msg.s_status.cfg_aggregators).length);
		printf('    %-9s %d\n', '# instrs:',
		    Object.keys(msg.s_status.cfg_instrumenters).length);
		printf('    %-9s %d\n', '# instns:',
		    Object.keys(msg.s_status.cfg_insts).length);
		printf('    %-9s %d\n', '# scopes:',
		    Object.keys(msg.s_status['instn-scopes']).length);
	});

	printf('\n');
	ccSumSvcSummary(svcs);
	bytype['config'].forEach(ccSumSvcSummary.bind(null, svcs));
	bytype['stash'].forEach(ccSumSvcSummary.bind(null, svcs));
	bytype['aggregator'].forEach(ccSumSvcSummary.bind(null, svcs));
	bytype['instrumenter'].forEach(ccSumSvcSummary.bind(null, svcs));

	if (bytype['aggregator'].length > 0) {
		printf('\n');
		ccSumSvcAggr(svcs, false);
		bytype['aggregator'].forEach(
		    ccSumSvcAggr.bind(null, svcs, cc_verbose));
	}

	if (bytype['instrumenter'].length > 0) {
		printf('\n');
		bytype['instrumenter'].forEach(ccSumSvcInstr.bind(null, svcs,
		    cc_verbose));
	}

	bytype['config'].forEach(ccSumCfgInstns.bind(null, svcs, cc_verbose));

	shutdown();
}

cc_cmdswitch['abort'] = ccRunCmdCmd;
cc_cmdswitch['ping'] = ccRunCmdCmd;
cc_cmdswitch['status'] = ccRunCmdStatus;
cc_cmdswitch['log'] = ccRunCmdLog;
cc_cmdswitch['stash'] = ccRunCmdStash;
cc_cmdswitch['summary'] = ccRunCmdSummarize;

main();
