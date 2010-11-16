/*
 * caconfigsvc: Cloud Analytics Configuration Service
 *
 * This service is responsible for directing other components of the cloud
 * analytics service, including instrumenters, aggregators, and retrievers.
 */

var mod_ca = require('ca');
var mod_caamqp = require('ca-amqp');
var mod_cahttp = require('./caconfig/http');
var HTTP = require('http-constants');

var cfg_http_port = 8280;	/* HTTP port for API endpoint */
var cfg_sysinfo;		/* basic system information */
var cfg_http;			/* http interface handle */
var cfg_amqp;			/* amqp interface handle */
var cfg_aggregators = {};	/* all aggregators, by hostname */
var cfg_instrumenters = {};	/* all instrumenters, by hostname */

function main()
{
	cfg_sysinfo = mod_ca.caSysinfo('configsvc', '0.0');
	var hostname = cfg_sysinfo.ca_hostname;
	var http_port = cfg_http_port;
	var amqp = {
		broker: mod_ca.ca_amqp_default_broker,
		exchange: mod_ca.ca_amqp_exchange,
		exchange_opts: mod_ca.ca_amqp_exchange_opts,
		basename: mod_ca.ca_amqp_key_base_config,
		hostname: hostname,
		bindings: [ mod_ca.ca_amqp_key_config ]
	};

	if (!hostname) {
		console.log('HOST not set in environment.  Bailing.');
		process.exit(2);
	}

	cfg_http = new mod_cahttp.caConfigHttp({ port: http_port });
	cfg_http.on('inst-create', cfgCreateInstrumentation);
	cfg_http.on('inst-delete', cfgDeleteInstrumentation);
	cfg_http.on('inst-value', cfgGetInstrumentation);

	cfg_amqp = new mod_caamqp.caAmqp(amqp);
	cfg_amqp.on('amqp-error', cfgAmqpLogError);
	cfg_amqp.on('amqp-fatal', cfgAmqpFatal);
	cfg_amqp.on('msg', cfgAmqpProcessMessage);

	console.log('Hostname:    ' + hostname);
	console.log('AMQP broker: ' + JSON.stringify(amqp['broker']));
	console.log('Routing key: ' + cfg_amqp.routekey());
	console.log('HTTP server: Port ' + http_port);
	console.log('');

	cfg_amqp.start(function () {
		console.log('AMQP broker connected.');
	});

	cfg_http.start(function () {
		console.log('HTTP server started.');
	});
}

var cfg_inst_id = 1;
var cfg_insts = {};

function cfgCreateInstrumentation(args, callback)
{
	var id;
	var instspec = args['spec'];
	var check = function (obj, field, type, required) {
		if (required && !obj[field])
			throw (new Error('missing required field: ' + field));

		if (!obj[field])
			return;

		if (typeof (type) != typeof (obj[field]))
			throw (new Error('wrong type for field: ' + field));
	};

	check(instspec, 'module', '', true);
	check(instspec, 'stat', '', true);
	check(instspec, 'nodes', [], false);
	check(instspec, 'predicate', [], false);
	check(instspec, 'decomposition', [], false);

	id = cfg_inst_id++;
	cfg_insts[id] = true;
	callback(HTTP.CREATED, { new_id: id });
}

function cfgDeleteInstrumentation(args, callback)
{
	if (!(args['instid'] in cfg_insts)) {
		callback(HTTP.ENOTFOUND, HTTP.MSG_NOTFOUND);
		return;
	}

	delete (cfg_insts[args['instid']]);
	callback(HTTP.OK);
}

function cfgGetInstrumentation(args, callback)
{
	if (!(args['instid'] in cfg_insts)) {
		callback(HTTP.ENOTFOUND, HTTP.MSG_NOTFOUND);
		return;
	}

	callback(HTTP.OK, { value: parseInt(Math.random() * 50, 10) });
}

function cfgAmqpLogError(error)
{
	console.log('warning: amqp: ' + error.message);
}

function cfgAmqpFatal(error)
{
	console.log('fatal error: amqp: ' + error.message);
	console.log('failed to maintain AMQP connection.  shutting down.');
	process.exit(3);
}

var cfg_msgswitch = {
	'cmd':	{
	    'ping': cfgCmdPing,
	    'status': cfgCmdStatus
	},
	'notify': {
	    'aggregator_online': cfgNotifyAggregatorOnline,
	    'instrumenter_error': cfgNotifyInstrumenterError,
	    'instrumenter_online': cfgNotifyInstrumenterOnline,
	    'log': cfgNotifyLog
	}
};

/*
 * Process a received AMQP message.  We dispatch based on type and subtype, and
 * also attempt to perform some common checks here (like making sure commands
 * have a source and id so we can send a response back).
 */
function cfgAmqpProcessMessage(msg)
{
	var type, subtype;

	if (!('ca_type' in msg)) {
		console.log('dropping msg with unspecified type');
		return;
	}

	type = msg.ca_type;

	if (!(type in cfg_msgswitch)) {
		console.log('dropping msg for unhandled type: ' + type);
		return;
	}

	if (type == 'cmd') {
		if (!('ca_source' in msg)) {
			console.log('dropping cmd msg with no source');
			return;
		}

		if (!('ca_id' in msg)) {
			console.log('dropping cmd msg with no id');
			return;
		}
	}

	if (!('ca_subtype' in msg)) {
		console.log('dropping msg with unspecified subtype');
		return;
	}

	subtype = msg.ca_subtype;

	if (!(subtype in cfg_msgswitch[type])) {
		console.log('dropping msg with unhandled subtype: ' + subtype);
		return;
	}

	cfg_msgswitch[type][subtype](msg);
}

function cfgCmdPing(msg)
{
	var rspmsg, key;

	if (mod_ca.caIncompatible(msg)) {
		console.log('dropping msg with incompatible version');
		return;
	}

	rspmsg = {
	    ca_type: 'ack',
	    ca_subtype: msg['ca_subtype'],
	    ca_id: msg['ca_id'],
	    ca_source: cfg_amqp.routekey()
	};

	for (key in cfg_sysinfo)
		rspmsg[key] = cfg_sysinfo[key];

	cfg_amqp.send(msg['ca_source'], rspmsg);
}

function cfgCmdStatus(msg)
{
	var rspmsg, key;

	if (mod_ca.caIncompatible(msg)) {
		console.log('dropping msg with incompatible version');
		return;
	}

	rspmsg = {
	    ca_type: 'ack',
	    ca_subtype: msg['ca_subtype'],
	    ca_id: msg['ca_id'],
	    s_component: 'config',
	    ca_source: cfg_amqp.routekey()
	};

	for (key in cfg_sysinfo)
		rspmsg[key] = cfg_sysinfo[key];

	/* XXX add instrumenters, aggregators */
	rspmsg.s_instrumenters = [];
	rspmsg.s_aggregators = [];

	cfg_amqp.send(msg['ca_source'], rspmsg);
}

function cfgNotifyAggregatorOnline(msg)
{
	var agg;

	if (mod_ca.caIncompatible(msg)) {
		console.log('dropping msg with incompatible version');
		return;
	}

	agg = {};
	agg.cag_hostname = msg.ca_hostname;
	agg.cag_routekey = msg.ca_source;
	agg.cag_agent_name = msg.ca_agent_name;
	agg.cag_agent_version = msg.ca_agent_version;
	agg.cag_os_name = msg.ca_os_name;
	agg.cag_os_release = msg.ca_os_release;
	agg.cag_os_revision = msg.ca_os_revision;

	/* XXX if already exists, it restarted, so need to update its state! */
	cfg_aggregators[agg.cag_hostname] = agg;
}

function cfgNotifyInstrumenterOnline(msg)
{
	var inst;

	if (mod_ca.caIncompatible(msg)) {
		console.log('dropping msg with incompatible version');
		return;
	}

	inst = {};
	inst.ins_hostname = msg.ca_hostname;
	inst.ins_routekey = msg.ca_source;
	inst.ins_agent_name = msg.ca_agent_name;
	inst.ins_agent_version = msg.ca_agent_version;
	inst.ins_os_name = msg.ca_os_name;
	inst.ins_os_release = msg.ca_os_release;
	inst.ins_os_revision = msg.ca_os_revision;

	/* XXX load module info into global cfg_statmods */
	/* XXX if already exists, it restarted, so need to update its state! */

	cfg_instrumenters[inst.ins_hostname] = inst;
}

function cfgNotifyLog(msg)
{
	if (mod_ca.caIncompatible(msg)) {
		console.log('dropping msg with incompatible version');
		return;
	}

	if (!('ca_hostname' in msg) || !('ca_time' in msg) ||
	    !('l_message' in msg)) {
		console.log('dropping log msg with missing fields');
		return;
	}

	console.log('WARNING: ' + msg.ca_hostname + ': ' + msg.ca_time + ': ' +
	    msg.l_message);
}

function cfgNotifyInstrumenterError(msg)
{
	if (!('ins_inst_id' in msg) || !('ins_error' in msg) ||
	    !('ca_hostname' in msg) || !('ins_status' in msg) ||
	    (msg['status'] != 'enabled' && msg['status'] != 'disabled')) {
		console.log('dropping malformed inst error message');
		return;
	}

	if (!(msg.ca_hostname in cfg_instrumenters)) {
		console.log('dropping inst error message for unknown host "' +
		    msg.ca_hostname + '"');
		return;
	}

	/* XXX */
}

main();
