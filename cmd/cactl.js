/*
 * cactl: poke and prod components of a Cloud Analytics instance
 */

var mod_ca = require('ca');
var mod_caamqp = require('ca-amqp');

var cc_timeout_msec = 3 * 1000;		/* timeout after 3s */
var cc_cmdswitch = {};			/* dispatch cmds */
var cc_ackswitch = {};			/* dispatch recvd messages */
var cc_amqp;				/* ca-amqp handle */
var cc_toid;				/* timeout handle */
var cc_cmd;				/* command sent */
var cc_start;				/* time cmd was sent */
var cc_sysinfo;				/* common packet info */
var cc_routekey;			/* our unique routing key */
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

	cc_sysinfo = mod_ca.caSysinfo('cactl', '0.1');

	var hostname = cc_sysinfo.ca_hostname+ '.' + process.pid;

	var amqp = {
		broker: mod_ca.ca_amqp_default_broker,
		exchange: mod_ca.ca_amqp_exchange,
		exchange_opts: mod_ca.ca_amqp_exchange_opts,
		basename: mod_ca.ca_amqp_key_base_tool,
		hostname: hostname,
		bindings: []
	};

	cc_amqp = new mod_caamqp.caAmqp(amqp);
	cc_routekey = cc_amqp.routekey();
	cc_amqp.on('amqp-error', function (err) {
		console.log('amqp: ' + err.message);
	});
	cc_amqp.on('amqp-fatal', function (err) {
		die('amqp: ' + err.message);
	});
	cc_amqp.on('msg', ccReceiveMsg);
	/* XXX */
	cc_amqp.start(function () { setTimeout(ccRunCmd, 500) });
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
	cc_amqp.send(destkey, msg);

	if (msg['ca_type'] == 'cmd')
		cc_toid = setTimeout(ccTimeout, cc_timeout_msec);
	else
		shutdown();
}

function ccRunCmdCmd(cmd)
{
	var msg;

	msg = mod_ca.caDeepCopy(cc_sysinfo);
	msg.ca_id = 1;
	msg.ca_source = cc_routekey;
	msg.ca_type = 'cmd';
	msg.ca_subtype = cmd;

	return (msg);
}

cc_cmdswitch['ping'] = ccRunCmdCmd;
cc_cmdswitch['status'] = ccRunCmdCmd;

function ccRunLogCmd()
{
	var msg;

	if (process.argv.length < 5)
		usage('missing log message');

	msg = mod_ca.caDeepCopy(cc_sysinfo);
	msg.ca_type = 'notify';
	msg.ca_subtype = 'log';
	msg.ca_time = new Date();
	msg.l_message = process.argv[4];
	return (msg);
}

cc_cmdswitch['log'] = ccRunLogCmd;

function ccReceiveMsg(msg)
{
	var end = new Date();
	var millis = end.getTime() - cc_start.getTime();

	if (mod_ca.caIncompatible(msg))
		die('response had incompatible version');
	
	if (msg.ca_type !== 'ack')
		die('response message had wrong type: ' + msg.ca_type);
	
	if (msg.ca_subtype !== cc_cmd)
		die('response message had wrong subtype: ' + msg.ca_subtype);

	if (msg.ca_id !== 1)
		die('response message had wrong id: ' + msg.ca_id);

	console.log('response time: ' + millis + ' milliseconds');
	cc_ackswitch[msg.ca_subtype](msg);
	clearTimeout(cc_toid);
	shutdown();
}

function ccAckPing(msg)
{
	console.log('Hostname:   ' + msg.ca_hostname);
	console.log('Route key:  ' + msg.ca_source);
	console.log('Agent:      ' + msg.ca_agent_name + '/' +
	    msg.ca_agent_version);
	console.log('OS:         ' + msg.ca_os_name + ' ' +
	    msg.ca_os_release + ' ' + msg.ca_os_revision);
}

cc_ackswitch['ping'] = ccAckPing;

function ccAckStatus(msg)
{
	var elts, ii;

	console.log('Hostname:      ' + msg.ca_hostname);
	console.log('Route key:     ' + msg.ca_source);
	console.log('Agent:         ' + msg.ca_agent_name + '/' +
	    msg.ca_agent_version);
	console.log('OS:            ' + msg.ca_os_name + ' ' +
	    msg.ca_os_release + ' ' + msg.ca_os_revision);
	console.log('Component:     ' + msg.s_component);

	switch (msg.s_component) {
	case 'config':
		elts = msg.s_instrumenters;
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

	default:
		console.log('unknown component type');
		break;
	}
}

cc_ackswitch['status'] = ccAckStatus;

main();
