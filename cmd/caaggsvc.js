/*
 * caaggsvc: Cloud Analytics Aggregator/Retriever service
 */

var mod_ca = require('ca');
var mod_caamqp = require('ca-amqp');
var mod_cap = require('ca-amqp-cap');
var mod_cahttp = require('./caconfig/http');
var mod_log = require('ca-log');
var HTTP = require('http-constants');

var agg_name = 'aggsvc';	/* component name */
var agg_vers = '0.0';		/* component version */
var agg_http_port = 23182;	/* http port */

var agg_insts = {};		/* active instrumentations by id */

var agg_http;			/* http interface handle */
var agg_cap;			/* cap wrapper */
var agg_log;			/* log handle */

function main()
{
	var http_port = agg_http_port;
	var broker = mod_ca.ca_amqp_default_broker;
	var sysinfo = mod_ca.caSysinfo(agg_name, agg_vers);
	var hostname = sysinfo.ca_hostname;
	var amqp;

	agg_log = new mod_log.caLog({ out: process.stdout });

	amqp = new mod_caamqp.caAmqp({
		broker: broker,
		exchange: mod_ca.ca_amqp_exchange,
		exchange_opts: mod_ca.ca_amqp_exchange_opts,
		basename: mod_ca.ca_amqp_key_base_aggregator,
		hostname: hostname,
		bindings: []
	});
	amqp.on('amqp-error', mod_caamqp.caAmqpLogError);
	amqp.on('amqp-fatal', mod_caamqp.caAmqpFatalError);

	agg_cap = new mod_cap.capAmqpCap({
	    amqp: amqp,
	    log: agg_log,
	    sysinfo: sysinfo
	});
	agg_cap.on('msg-cmd-ping', aggCmdPing);
	agg_cap.on('msg-cmd-status', aggCmdStatus);
	agg_cap.on('msg-cmd-enable_aggregation', aggCmdEnableAggregation);
	agg_cap.on('msg-data', aggData);

	/* XXX refactor to non-config subdir */
	agg_http = new mod_cahttp.caConfigHttp({
	    log: agg_log, port: http_port
	});
	agg_http.on('inst-value', aggHttpValue);

	agg_log.info('Aggregator starting up (%s/%s)', agg_name, agg_vers);
	agg_log.info('%-12s %s', 'Hostname:', hostname);
	agg_log.info('%-12s %s', 'AMQP broker:', JSON.stringify(broker));
	agg_log.info('%-12s %s', 'Routing key:', amqp.routekey());
	agg_log.info('%-12s Port %d', 'HTTP server:', http_port);

	agg_http.start(function () {
		agg_log.info('HTTP server started.');
		amqp.start(aggStarted);
	});
}

function aggStarted()
{
	var msg;

	agg_log.info('AMQP broker connected.');

	msg = {};
	msg.ca_type = 'notify';
	msg.ca_subtype = 'aggregator_online';

	/* XXX should we send this periodically too?  every 5 min or whatever */
	agg_cap.send(mod_ca.ca_amqp_key_config, msg);
}

function aggCmdEnableAggregation(msg)
{
	var sendmsg = agg_cap.responseTemplate(msg);
	var destkey = msg.ca_source;
	var id, datakey;

	sendmsg.ag_inst_id = msg.ag_inst_id;

	if (!('ag_inst_id' in msg) || !('ag_key' in msg)) {
		sendmsg.ag_status = 'enable_failed';
		sendmsg.ag_error = 'missing field';
		agg_cap.send(destkey, sendmsg);
		return;
	}

	id = msg.ag_inst_id;
	datakey = msg.ag_key;

	/*
	 * This command is idempotent so if we're currently aggregating this
	 * instrumentation then we're already done.
	 */
	if (id in agg_insts) {
		/* XXX check against key */
		sendmsg.ag_status = 'enabled';
		agg_cap.send(destkey, sendmsg);
		return;
	}

	agg_cap.bind(datakey, function () {
		agg_insts[id] = {
		    agi_since: new Date(),
		    agi_sources: { sources: {}, nsources: 0 },
		    agi_values: {},
		    agi_last: 0
		};
		sendmsg.ag_status = 'enabled';
		agg_cap.send(destkey, sendmsg);
	});
}

/*
 * Process AMQP ping command.
 */
function aggCmdPing(msg)
{
	agg_cap.send(msg.ca_source, agg_cap.responseTemplate(msg));
}

/*
 * Process AMQP status command.
 */
function aggCmdStatus(msg)
{
	var sendmsg = agg_cap.responseTemplate(msg);
	var id, inst;

	sendmsg.s_component = 'aggregator';
	sendmsg.s_instrumentations = [];

	for (id in agg_insts) {
		inst = agg_insts[id];
		sendmsg.s_instrumentations.push({
		    s_inst_id: id,
		    s_since: inst.agi_since,
		    s_nsources: inst.agi_sources.nsources,
		    s_last: inst.agi_last,
		    s_data: inst.agi_values[inst.agi_last]
		});
	}

	agg_cap.send(msg.ca_source, sendmsg);
}

/*
 * Receive data.  This is what we were born to do -- this is the data hot path.
 */
function aggData(msg)
{
	var id = msg.d_inst_id;
	var value = msg.d_value;
	var time = msg.d_time;
	var hostname = msg.ca_hostname;
	var inst;
	var callbacks, ii;

	if (id === undefined || value === undefined || time === undefined) {
		agg_log.warn('dropped data message with missing field');
		return;
	}

	inst = agg_insts[id];
	time = parseInt(time / 1000, 10);

	if (inst === undefined) {
		agg_log.warn('dropped data message for unknown id: %s', id);
		return;
	}

	if (inst.agi_last < time)
		inst.agi_last = time;

	if (!(hostname in inst.agi_sources.sources)) {
		inst.agi_sources.sources[hostname] = {};
		inst.agi_sources.nsources++;
	}

	inst.agi_sources.sources[hostname].ags_last = time;

	if (!(time in inst.agi_values)) {
		/* First record for this time index. */
		inst.agi_values[time] =
		    { value: value, count: 1, callbacks: []};
		return;
	}

	inst.agi_values[time].count++;

	if (inst.agi_values[time].value === undefined &&
	    inst.agi_values[time].count === 0) {
		inst.agi_values[time].value = value;
	} else {
		aggAggregateValue(inst, time, value);
	}

	/*
	 * Wake up waiting HTTP requests.
	 */
	if (inst.agi_values[time].count != inst.agi_sources.nsources)
		return;

	callbacks = inst.agi_values[time].callbacks;
	for (ii = 0; ii < callbacks.length; ii++)
		callbacks[ii]();
}

function aggAggregateValue(inst, time, newval)
{
	if (typeof (newval) == 'number') {
		inst.agi_values[time].value += newval;
		return;
	}

	agg_log.error('unsupported aggregation type: %s', typeof (newval));
}

/*
 * Process the request to retrieve a metric's value.
 */
function aggHttpValue(args, callback)
{
	var id = args['instid'];
	var inst, when, record, complete, delayed;

	if (!(id in agg_insts)) {
		callback(HTTP.ENOTFOUND, HTTP.MSG_NOTFOUND);
		return;
	}

	inst = agg_insts[id];
	/* XXX add start, duration parameters */
	when = parseInt(new Date().getTime() / 1000, 10) - 1;
	record = inst.agi_values[when];

	complete = function () {
		var ret = {};

		ret.when = when;
		ret.value = record.value;
		ret.nreporting = record.count;
		ret.nsources = inst.agi_sources.nsources;

		if (delayed)
			ret.delayed = new Date().getTime() - delayed;

		callback(HTTP.OK, ret);
	};

	/*
	 * XXX need some way of noticing attrition?
	 * XXX check for date in the future or way in the past so we don't hang
	 * requests and we don't autocreate tons of these buckets
	 */
	if (record === undefined) {
		inst.agi_values[when] =
		    { value: undefined, count: 0, callbacks: [] };
		record = inst.agi_values[when];
	}

	if (record.value === undefined ||
	    record.count < inst.agi_sources.nsources) {
		delayed = new Date().getTime();
		record.callbacks.push(complete);
		return;
	}

	complete();
}

/* XXX add timeout to expire old HTTP requests */

main();
