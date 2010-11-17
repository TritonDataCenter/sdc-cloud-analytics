/*
 * cactl: poke and prod components of a Cloud Analytics instance
 */

var mod_ca = require('ca');
var mod_caamqp = require('ca-amqp');
var mod_cap = require('ca-amqp-cap');

var cc_timeout_msec = 3 * 1000;		/* timeout after 3s */
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
    '        ping		check connectivity',
    '        status		get detailed status info',
    '        log <msg>		report log message'
].join('\n');

function main()
{
	if (process.argv.length <= 2)
		usage();

	var broker = mod_ca.ca_amqp_default_broker;
	var sysinfo = mod_ca.caSysinfo('cactl', '0.1');
	var hostname = sysinfo.ca_hostname+ '.' + process.pid;

	cc_amqp = new mod_caamqp.caAmqp({
		broker: broker,
		exchange: mod_ca.ca_amqp_exchange,
		exchange_opts: mod_ca.ca_amqp_exchange_opts,
		basename: mod_ca.ca_amqp_key_base_tool,
		hostname: hostname,
		bindings: []
	});
	cc_amqp.on('amqp-error', function (err) {
		console.log('amqp: ' + err.message);
	});
	cc_amqp.on('amqp-fatal', function (err) {
		die('amqp: ' + err.message);
	});

	cc_cap = new mod_cap.capAmqpCap({
	    amqp: cc_amqp, sysinfo: sysinfo
	});
	cc_cap.on('msg-ack-ping', ccAckPing);
	cc_cap.on('msg-ack-status', ccAckStatus);

	cc_amqp.start(ccRunCmd);
}

function usage(msg)
{
	if (msg)
		console.log(cc_arg0 + ': ' + msg);
	console.log(cc_help);
	process.exit(2);
}

function die(msg)
{
	console.log(cc_arg0 + ': fatal error: ' + msg);
	process.exit(1);
}

function shutdown()
{
	cc_amqp.stop();
}

function ccTimeout()
{
	console.log('Timed out.');
	process.exit(3);
}

function ccRunCmd()
{
	var destkey = process.argv[2];
	var msg;

	cc_cmd = process.argv[3];

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
		die('response message had wrong subtype: ' + msg.ca_subtype);

	if (msg.ca_id !== 1)
		die('response message had wrong id: ' + msg.ca_id);

	console.log('response time: ' + millis + ' milliseconds');
	clearTimeout(cc_toid);
}

function ccAckPing(msg)
{
	ccCheckMsg(msg);
	console.log('Hostname:   ' + msg.ca_hostname);
	console.log('Route key:  ' + msg.ca_source);
	console.log('Agent:      ' + msg.ca_agent_name + '/' +
	    msg.ca_agent_version);
	console.log('OS:         ' + msg.ca_os_name + ' ' +
	    msg.ca_os_release + ' ' + msg.ca_os_revision);
	shutdown();
}

function ccAckStatus(msg)
{
	var elts, ii;

	ccCheckMsg(msg);
	console.log('Hostname:      ' + msg.ca_hostname);
	console.log('Route key:     ' + msg.ca_source);
	console.log('Agent:         ' + msg.ca_agent_name + '/' +
	    msg.ca_agent_version);
	console.log('OS:            ' + msg.ca_os_name + ' ' +
	    msg.ca_os_release + ' ' + msg.ca_os_revision);
	console.log('Component:     ' + msg.s_component);

	switch (msg.s_component) {
	case 'config':
		elts = msg.s_aggregators;
		console.log('Aggregators:   ' + elts.length + ' total');
		for (ii = 0; ii < elts.length; ii++) {
			console.log('    ' + elts[ii].sia_hostname + ' (' +
			    elts[ii].sia_ninsts + ' instrumentations)');
		}

		elts = msg.s_instrumenters;
		console.log('Instrumenters: ' + elts.length + ' total');
		for (ii = 0; ii < elts.length; ii++) {
			console.log('    ' + elts[ii].sii_hostname + ' (' +
			    elts[ii].sii_nmetrics_avail + ' metrics, ' +
			    elts[ii].sii_ninsts + ' active instrumentations)');
		}

		break;

	case 'instrumenter':
		elts = msg.s_instrumentations;
		console.log('Active inst:   (' + elts.length + ' total)');
		for (ii = 0; ii < elts.length; ii++) {
			console.log('    ' + elts[ii].s_inst_id + ': ' +
			    elts[ii].s_module + '.' + elts[ii].s_stat + '.' +
			    ' (' + (elts[ii].s_predicate ? 'P' : '_') +
			    (elts[ii].s_decomposition ? 'D' : '_') + ')' +
			    ' since ' + elts[ii].s_since);
		}

		break;

	default:
		console.log('unknown component type');
		break;
	}

	shutdown();
}

main();
