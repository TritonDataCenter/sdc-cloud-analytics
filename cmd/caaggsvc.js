/*
 * caaggsvc: Cloud Analytics Aggregator/Retriever service
 */

var mod_ca = require('ca');
var mod_caamqp = require('ca-amqp');
var mod_cap = require('ca-amqp-cap');
var mod_cahttp = require('./caconfig/http');
var mod_log = require('ca-log');
var HTTP = require('http-constants');
var ASSERT = require('assert');

var agg_name = 'aggsvc';		/* component name */
var agg_vers = '0.0';			/* component version */
var agg_http_port = 23182;		/* http port */
var agg_http_req_timeout = 5000;	/* max milliseconds to wait for data */

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
		setTimeout(aggTick, 1000);
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
	var dimension;

	sendmsg.ag_inst_id = msg.ag_inst_id;

	if (!('ag_inst_id' in msg) || !('ag_key' in msg) ||
	    !('ag_dimension' in msg)) {
		sendmsg.ag_status = 'enable_failed';
		sendmsg.ag_error = 'missing field';
		agg_cap.send(destkey, sendmsg);
		return;
	}

	id = msg.ag_inst_id;
	datakey = msg.ag_key;
	dimension = msg.ag_dimension;

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
		    agi_dimension: dimension,
		    agi_since: new Date(),
		    agi_sources: { sources: {}, nsources: 0 },
		    agi_values: {},
		    agi_last: 0,
		    agi_requests: []
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
	var inst, rq, ii;

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
		inst.agi_values[time] = { value: value, count: 1};
	} else {
		inst.agi_values[time].count++;
		aggAggregateValue(inst, time, value);
	}

	/*
	 * If we have all the data we're expecting for this time index, wake up
	 * HTTP requests which may now be satisfied.  We examine all of the
	 * requests waiting on data for this instrumentation and we wake up
	 * those that were waiting for data for this time index as well as those
	 * waiting for data from earlier times, on the assumption that if we got
	 * data from all instrumenters for this time, we won't some time later
	 * get data from any of them for some previous time index.
	 */
	ASSERT.ok(inst.agi_values[time].count <= inst.agi_sources.nsources);
	if (inst.agi_values[time].count != inst.agi_sources.nsources) {
		agg_log.dbg('waiting for more data (expected %d, have %d)',
		    inst.agi_sources.nsources, inst.agi_values[time].count);
		return;
	}

	for (ii = 0; ii < inst.agi_requests.length; ii++) {
		rq = inst.agi_requests[ii];

		if (rq.datatime <= time) {
			inst.agi_requests.splice(ii--, 1);
			aggHttpValueDone(id, rq.datatime, rq.callback);
			agg_log.dbg('delay-satisfied request for %d time %d ' +
			    'processing data for %d', id, rq.datatime, time);
		}
	}
}

function aggAggregateValue(inst, time, newval)
{
	var vec, key;

	if (typeof (newval) == 'number') {
		inst.agi_values[time].value += newval;
		return;
	}

	vec = inst.agi_values[time].value;

	for (key in newval) {
		if (!(key in vec))
			vec[key] = 0;

		vec[key] += newval[key];
	}
}

/*
 * Process the request to retrieve a metric's value.
 * XXX add start, duration parameters.  When we do, it should be illegal for
 * 'start' to be before the earliest time for which we have data (approximated
 * by the s_since field) or more than TIMEOUT seconds in the future (since it
 * will definitely time out).  Otherwise, client requests could hang/time out,
 * which also taxes us (since we keep these in memory).
 * Also, when we add this, we need to make sure that the 'when' that gets stored
 * in agi_requests is still the current time, not the time we were looking for.
 * XXX need some way of noticing when instrumenters are gone for a while --
 * putting them into a "don't wait for me" state.
 * XXX parameter for "don't wait" or "max time to wait"?
 */
function aggHttpValue(args, callback)
{
	var id = args['instid'];
	var inst, now, when, record;

	if (!(id in agg_insts)) {
		callback(HTTP.ENOTFOUND, HTTP.MSG_NOTFOUND);
		return;
	}

	inst = agg_insts[id];
	now = new Date().getTime();
	when = parseInt(now / 1000, 10) - 1;
	record = inst.agi_values[when];

	if (record && record.count == inst.agi_sources.nsources) {
		aggHttpValueDone(id, when, callback);
		return;
	}

	/*
	 * We don't have all the data we're expecting for this time index yet,
	 * but we expect to get it in the near future.  We add a record to this
	 * instrumentation's list of outstanding requests.  When new data comes
	 * in, we'll figure out if we should process this request.  There's also
	 * a timer that periodically times these out.
	 */
	agg_log.dbg('client request for %s at %d needs to wait', id, when);
	inst.agi_requests.push({
	    rqtime: now,
	    datatime: when,
	    callback: callback
	});
}

function aggHttpValueDone(id, when, callback)
{
	var inst = agg_insts[id];
	var record = inst.agi_values[when];
	var ret;

	ret = {};
	ret.when = when;
	ret.nsources = inst.agi_sources.nsources;

	if (record) {
		ret.value = record.value;
		ret.nreporting = record.count;
	} else {
		ret.value = inst.agi_dimension > 1 ? {} : 0;
		ret.nreporting = 0;
	}

	callback(HTTP.OK, ret);
}

/*
 * Invoked once/second to time out old HTTP requests.
 */
function aggTick()
{
	var id, inst, ii, rq;
	var now = new Date().getTime();

	for (id in agg_insts) {
		inst = agg_insts[id];
		for (ii = 0; ii < inst.agi_requests.length; ii++) {
			rq = inst.agi_requests[ii];

			ASSERT.ok(rq.rqtime <= now);

			if (now - rq.rqtime >= agg_http_req_timeout) {
				inst.agi_requests.splice(ii--, 1);
				aggHttpValueDone(id, rq.datatime, rq.callback);
				agg_log.dbg('timed out request for %d time %d',
				    id, rq.datatime);
			}
		}
	}

	setTimeout(aggTick, 1000);
}

main();
