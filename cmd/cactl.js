/*
 * cactl: poke and prod components of a Cloud Analytics instance
 */

var mod_ca = require('../lib/ca/ca-common');
var mod_cap = require('../lib/ca/ca-amqp-cap');
var mod_log = require('../lib/ca/ca-log');
var mod_metric = require('../lib/ca/ca-metric');
var mod_sys = require('sys');

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
    'usage: cactl [-d] <hostname> <command> [...]',
    'Poke a cloud analytics instance via AMQP.',
    '    <hostname> is a routing key identifying a single system',
    '    	hint: try "ca.config" for the config server\n',
    '    <command> is one of:',
    '        abort              panic remote service (use with caution)',
    '        ping               check connectivity',
    '        status [-v]        get detailed status info',
    '                           with -v, print additional unstructured info',
    '        log <msg>          report log message',
    '        stash list         show list of stash buckets',
    '        stash del <bucket> delete stash bucket "bucket"',
    '        stash get <bucket> retrieve contents of stash bucket "bucket"',
    '        stash put <bucket> <contents> [<metadata>]',
    '                           save contents into stash bucket "bucket"\n',
    '    Global Options:',
    '        -d	print AMQP debug messages'
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

	if (cc_argv.length - cc_optind < 2)
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
	cc_cap.on('msg-ack-status', ccAckStatus);
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
	var destkey, msg;

	destkey = cc_argv[cc_optind++];
	cc_cmd = cc_argv[cc_optind++];

	if (cc_argv.length > cc_optind &&
	    cc_argv[cc_optind] == '-v') {
		cc_verbose = true;
		cc_optind++;
	} else {
		cc_verbose = false;
	}

	if (!(cc_cmd in cc_cmdswitch))
		usage('unrecognized command: ' + cc_cmd);

	msg = cc_cmdswitch[cc_cmd](cc_cmd);
	cc_start = new Date();
	cc_cap.send(destkey, msg);

	if (msg.ca_type == 'cmd')
		cc_toid = setTimeout(ccTimeout, cc_timeout_msec);
	else
		shutdown();
}

function ccRunCmdCmd(cmd)
{
	var msg = {};

	msg.ca_type = 'cmd';
	msg.ca_subtype = cmd;
	msg.ca_id = 1;

	return (msg);
}

cc_cmdswitch['abort'] = ccRunCmdCmd;
cc_cmdswitch['ping'] = ccRunCmdCmd;
cc_cmdswitch['status'] = ccRunCmdCmd;

function ccRunLogCmd()
{
	var msg = {};

	if (cc_argv.length <= cc_optind)
		usage('missing log message');

	msg.ca_type = 'notify';
	msg.ca_subtype = 'log';
	msg.l_message = cc_argv[cc_optind++];

	return (msg);
}

cc_cmdswitch['log'] = ccRunLogCmd;

function ccRunStashCmd()
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
		return (msg);
	}

	if (cc_argv.length <= cc_optind)
		usage('missing stash contents');

	msg.p_requests = [ {
	    bucket: bucket,
	    data: cc_argv[cc_optind++],
	    metadata: cc_argv.length > cc_optind ?
	        JSON.parse(cc_argv[cc_optind++]) : {}
	} ];

	return (msg);
}

cc_cmdswitch['stash'] = ccRunStashCmd;

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

function ccAckStatus(msg)
{
	var elts, ii;
	var metric, decomp, metadata;

	ccCheckMsg(msg);
	printf('%-12s %s\n', 'Hostname:', msg.ca_hostname);
	printf('%-12s %s\n', 'Route key:', msg.ca_source);
	printf('%-12s %s/%s\n', 'Agent:', msg.ca_agent_name,
	    msg.ca_agent_version);
	printf('%-12s %s %s %s\n', 'OS:', msg.ca_os_name,
	    msg.ca_os_release, msg.ca_os_revision);
	printf('%-12s %s\n', 'Component:', msg.s_component);

	switch (msg.s_component) {
	case 'config':
		elts = msg.s_aggregators;
		printf('%-28s    %-7s\n', 'AGGREGATORS', 'ACTIVE');
		for (ii = 0; ii < elts.length; ii++)
			printf('  %3d.  %-20s    %6d\n', ii + 1,
			    elts[ii].sia_hostname, elts[ii].sia_ninsts);

		elts = msg.s_instrumenters;
		printf('%-28s    %-7s\n', 'INSTRUMENTERS', 'ACTIVE');
		for (ii = 0; ii < elts.length; ii++)
			printf('  %3d.  %-20s    %6d\n', ii + 1,
			    elts[ii].sii_hostname, elts[ii].sii_ninsts);
		break;

	case 'instrumenter':
		elts = msg.s_instrumentations;
		if (elts.length > 0) {
			printf('\nActive Instrumentations:\n');
			printf('    %-15s  %-20s  %-5s  %s\n', 'INSTN',
			    'METRIC', 'PRED?', 'DECOMP');
		}

		for (ii = 0; ii < elts.length; ii++) {
			metric = mod_ca.caSprintf('%s.%s',
			    elts[ii].s_module, elts[ii].s_stat);
			decomp = elts[ii].s_decomposition.join(', ');
			if (!decomp)
				decomp = 'None';
			printf('    %-15s  %-20s  %-5s  %s\n',
			    elts[ii].s_inst_id, metric,
			    elts[ii].s_predicate.length > 0 ?  'Yes' : 'No',
			    decomp);
		}

		printf('\nAvailable metrics:\n');
		metadata = new mod_metric.caMetricMetadata();
		metadata.addFromHost(msg.s_metadata, 'remote host');
		metadata.report(process.stdout, true);
		break;

	case 'aggregator':
		elts = msg.s_instrumentations;
		if (elts.length > 0) {
			printf('Active instrumentations:   (%d total)\n',
			    elts.length);
			printf('    %-6s  %-8s  %-27s  %-27s\n', 'INSTID',
			    'NSOURCES', 'SINCE', 'LAST');
		}

		for (ii = 0; ii < elts.length; ii++) {
			printf('    %6s  %8d  %27s  %27s\n',
			    elts[ii].s_inst_id, elts[ii].s_nsources,
			    mod_ca.caFormatDate(new Date(
			    Date.parse(elts[ii].s_since))),
			    mod_ca.caFormatDate(
			    new Date(elts[ii].s_last * 1000)));
		}

		break;

	case 'stash':
		break;

	default:
		printf('unknown component type\n');
		break;
	}

	if (msg.s_status && cc_verbose) {
		printf('additional unstructured status information:\n');
		printf('%j\n', msg.s_status);
	}

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

main();
