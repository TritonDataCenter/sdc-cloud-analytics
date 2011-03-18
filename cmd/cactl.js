/*
 * cactl: poke and prod components of a Cloud Analytics instance
 */

var mod_ca = require('../lib/ca/ca-common');
var mod_caamqp = require('../lib/ca/ca-amqp');
var mod_cap = require('../lib/ca/ca-amqp-cap');
var mod_log = require('../lib/ca/ca-log');
var mod_sys = require('sys');

var cc_timeout_msec = 3 * 1000;		/* timeout after 3s */
var cc_verbose = false;
var cc_cmdswitch = {};			/* dispatch cmds */
var cc_amqp;				/* ca-amqp handle */
var cc_cap;				/* cap wrapper */
var cc_toid;				/* timeout handle */
var cc_cmd;				/* command sent */
var cc_start;				/* time cmd was sent */
var cc_arg0 = process.argv[1];
var cc_help = [
    'usage: cactl <hostname> <command>',
    'Poke a cloud analytics instance via AMQP.',
    '    <hostname> is a routing key identifying a single system',
    '    	hint: try "ca.config" for the config server',
    '    <command> is one of:',
    '	     abort		panic remote service (use with caution)',
    '        ping		check connectivity',
    '        status [-v]	get detailed status info',
    '                           with -v, print additional unstructured info',
    '        log <msg>		report log message'
].join('\n');

function printf()
{
	var text = mod_ca.caSprintf.apply(null, arguments);
	process.stdout.write(text);
}

function main()
{
	if (process.argv.length <= 2)
		usage();

	var broker = mod_ca.caBroker();
	var sysinfo = mod_ca.caSysinfo('cactl', '0.1');
	var hostname = sysinfo.ca_hostname+ '.' + process.pid;
	var log = new mod_log.caLog({ out: process.stdout });

	cc_amqp = new mod_caamqp.caAmqp({
		broker: broker,
		exchange: mod_ca.ca_amqp_exchange,
		exchange_opts: mod_ca.ca_amqp_exchange_opts,
		basename: mod_ca.ca_amqp_key_base_tool,
		hostname: hostname,
		bindings: [],
		log: log
	});
	cc_amqp.on('amqp-error', function (err) {
		die('amqp: %s', err.message);
	});
	cc_amqp.on('amqp-fatal', function (err) {
		die('amqp: %s', err.message);
	});

	cc_cap = new mod_cap.capAmqpCap({
	    log: log, amqp: cc_amqp, sysinfo: sysinfo
	});
	cc_cap.on('msg-ack-abort', ccAckAbort);
	cc_cap.on('msg-ack-ping', ccAckPing);
	cc_cap.on('msg-ack-status', ccAckStatus);

	cc_amqp.start(ccRunCmd);
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
	cc_amqp.stop();
}

function ccTimeout()
{
	printf('Timed out.\n');
	process.exit(3);
}

function ccRunCmd()
{
	var destkey = process.argv[2];
	var msg;

	cc_cmd = process.argv[3];

	cc_verbose = process.argv.length > 4 &&
	    process.argv[4] == '-v';

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

	if (process.argv.length < 5)
		usage('missing log message');

	msg.ca_type = 'notify';
	msg.ca_subtype = 'log';
	msg.l_message = process.argv[4];

	return (msg);
}

cc_cmdswitch['log'] = ccRunLogCmd;

function ccCheckMsg(msg)
{
	var end = new Date();
	var millis = end.getTime() - cc_start.getTime();

	if (msg.ca_subtype !== cc_cmd)
		die('response message had wrong subtype: %s', msg.ca_subtype);

	if (msg.ca_id !== 1)
		die('response message had wrong id: %s', msg.ca_id);

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
	var elts, elt, fields, ii, jj;
	var metric, decomp;

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
		printf('%-28s    %-7s    %-6s\n', 'INSTRUMENTERS',
		    'ACTIVE', 'METRICS');
		for (ii = 0; ii < elts.length; ii++)
			printf('  %3d.  %-20s    %6d    %7d\n', ii + 1,
			    elts[ii].sii_hostname, elts[ii].sii_ninsts,
			    elts[ii].sii_nmetrics_avail);
		break;

	case 'instrumenter':
		elts = msg.s_instrumentations;
		if (elts.length > 0)
			printf('%-6s  %-20s  %-5s  %s\n', 'INSTID', 'METRIC',
			    'PRED?', 'DECOMP');
		for (ii = 0; ii < elts.length; ii++) {
			metric = mod_ca.caSprintf('%s.%s',
			    elts[ii].s_module, elts[ii].s_stat);
			decomp = elts[ii].s_decomposition.join(', ');
			if (!decomp)
				decomp = 'None';
			printf('%6s  %-20s  %-5s  %s\n', elts[ii].s_inst_id,
			    metric, elts[ii].s_predicate.length > 0 ?
			    'Yes' : 'No',
			    decomp);
		}

		elts = msg.s_modules;
		if (elts.length > 0)
			printf('  %-45s  %-8s %s\n', 'METRIC', 'TYPE',
			    'FIELDS');

		for (ii = 0; ii < elts.length; ii++) {
			for (jj = 0; jj < elts[ii].cam_stats.length; jj++) {
				elt = elts[ii].cam_stats[jj];
				metric = mod_ca.caSprintf('%s: %s',
				    elts[ii].cam_description,
				    elt.cas_description);
				fields = elt.cas_fields.map(function (field) {
					return (field.caf_name);
				});

				decomp = 'None';
				if (fields.length > 0)
					decomp = fields.join(', ');

				printf('  %-45s  %-8s %s\n', metric,
				    elt.cas_type, decomp);
			}
		}

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

main();
