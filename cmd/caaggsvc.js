/*
 * caaggsvc: Cloud Analytics Aggregator/Retriever service
 */

var mod_ca = require('../lib/ca/ca-common');
var mod_caagg = require('../lib/ca/ca-agg.js');
var mod_caerr = require('../lib/ca/ca-error');
var mod_cap = require('../lib/ca/ca-amqp-cap');
var mod_cahttp = require('../lib/ca/ca-http');
var mod_dbg = require('../lib/ca/ca-dbg');
var mod_log = require('../lib/ca/ca-log');
var mod_cageoip = require('../lib/ca/ca-geo');
var mod_heatmap = require('heatmap');
var HTTP = require('../lib/ca/http-constants');
var ASSERT = require('assert');

var agg_name = 'aggsvc';		/* component name */
var agg_vers = '0.0';			/* component version */
var agg_http_req_timeout = 5000;	/* max milliseconds to wait for data */
var agg_http_baseuri = '/ca/';
var agg_http_port_base = mod_ca.ca_http_port_agg_base;
var agg_http_ipaddr = '127.0.0.1';	/* HTTP server address */
var agg_http_port;			/* actual http port */
var agg_profile = false;

var agg_insts = {};		/* active instrumentations by id */
var agg_start;			/* start time (in ms) */
var agg_http;			/* http server */
var agg_cap;			/* cap wrapper */
var agg_log;			/* log handle */
var agg_sysinfo;		/* system info config */

var agg_transforms = {};	/* available transformations by name */

var agg_stash_min_interval = 60 * 1000;		/* min freq for stash updates */
var agg_stash_timeout = 10 * 1000;		/* timeout for stash ops */
var agg_stash_load_retry = 60 * 1000;		/* time between load retries */
var agg_stash_saved;				/* last global save */

var agg_recent_interval = 2 * agg_http_req_timeout;	/* see aggExpected() */

/*
 * When we receive data messages from too far in the future, we log a warning
 * and drop the message.  We only want to log the warning if we haven't logged
 * this warning recently.
 */
var agg_future_interval = 10;			/* max seconds in the future */
var agg_future_warns = {};			/* last warning by hostname */
var agg_future_warn_interval = 60 * 60 * 1000;	/* warning frequency (1/hour) */

function main()
{
	var dbg_log, queue;

	agg_start = new Date().getTime();

	mod_dbg.caEnablePanicOnCrash();
	caDbg.set('agg_name', agg_name);
	caDbg.set('agg_vers', agg_vers);
	caDbg.set('agg_http_req_timeout', agg_http_req_timeout);
	caDbg.set('agg_http_baseuri', agg_http_baseuri);
	caDbg.set('agg_http_port_base', agg_http_port_base);
	caDbg.set('agg_profile', agg_profile);
	caDbg.set('agg_insts', agg_insts);
	caDbg.set('agg_start', agg_start);
	caDbg.set('agg_transforms', agg_transforms);
	caDbg.set('agg_future_interval', agg_future_interval);
	caDbg.set('agg_future_warns', agg_future_warns);
	caDbg.set('agg_future_warn_interval', agg_future_warn_interval);

	agg_sysinfo = mod_ca.caSysinfo(agg_name, agg_vers);
	caDbg.set('agg_sysinfo', agg_sysinfo);

	agg_log = new mod_log.caLog({ out: process.stderr });
	caDbg.set('agg_log', agg_log);

	if (process.argv.length > 2) {
		dbg_log = mod_log.caLogFromFile(process.argv[2],
		    { candrop: true }, mod_log.caLogError(agg_log));
		agg_log.info('Logging AMQP debug messages to "%s"',
		    process.argv[2]);
		caDbg.set('amqp_debug_log', dbg_log);
	}

	queue = mod_cap.ca_amqp_key_base_aggregator + agg_sysinfo.ca_hostname;
	agg_cap = new mod_cap.capAmqpCap({
	    dbglog: dbg_log,
	    keepalive: true,
	    log: agg_log,
	    queue: queue,
	    sysinfo: agg_sysinfo
	});

	caDbg.set('agg_cap', agg_cap);
	agg_cap.bind(mod_cap.ca_amqp_key_all);

	agg_cap.on('msg-cmd-status', aggCmdStatus);
	agg_cap.on('msg-cmd-enable_aggregation', aggCmdEnableAggregation);
	agg_cap.on('msg-cmd-disable_aggregation', aggCmdDisableAggregation);
	agg_cap.on('msg-data', aggData);
	agg_cap.on('msg-notify-configsvc_online', aggNotifyConfigRestarted);
	agg_cap.on('msg-notify-config_reset', aggNotifyConfigReset);

	agg_log.info('Aggregator starting up (%s/%s)', agg_name, agg_vers);
	agg_log.info('%-12s %s', 'Hostname:', agg_sysinfo.ca_hostname);
	agg_log.info('%-12s %s', 'AMQP broker:',
	    JSON.stringify(agg_cap.broker()));
	agg_log.info('%-12s %s', 'Routing key:', queue);

	aggInitBackends();

	agg_http = new mod_cahttp.caHttpServer({
	    log: agg_log,
	    port_base: agg_http_port_base,
	    router: aggHttpRouter
	});
	caDbg.set('agg_http', agg_http);

	agg_http.start(function () {
		agg_http_port = agg_http.port();
		caDbg.set('agg_http_port', agg_http_port_base);
		agg_log.info('%-12s Port %d (started)',
		    'HTTP server:', agg_http_port);
		agg_cap.on('connected', aggStarted);
		agg_cap.start();
		setTimeout(aggTick, 1000);
	});
}

function aggNotifyConfig()
{
	agg_cap.sendNotifyAggOnline(mod_cap.ca_amqp_key_config,
	    agg_http_ipaddr, agg_http_port, agg_transforms);
}

function aggStarted()
{
	agg_log.info('AMQP broker connected.');
	aggNotifyConfig();
}

function aggCmdEnableAggregation(msg)
{
	var destkey = msg.ca_source;
	var id, datakey;

	if (!('ag_inst_id' in msg) || !('ag_key' in msg) ||
	    !('ag_instrumentation' in msg)) {
		agg_cap.sendCmdAckEnableAggFail(destkey, msg.ca_id,
		    'missing field', msg.ag_inst_id);
		return;
	}

	id = msg.ag_inst_id;
	datakey = msg.ag_key;

	/*
	 * This command is idempotent so if we're currently aggregating this
	 * instrumentation then we're already done.
	 */
	if (id in agg_insts) {
		agg_insts[id].update(msg.ca_instrumentation);
		agg_cap.sendCmdAckEnableAggSuc(destkey, msg.ca_id, id);
		return;
	}

	agg_log.info('aggregating instn %s', id);
	agg_cap.bind(datakey, function () {
		agg_cap.sendCmdAckEnableAggSuc(destkey, msg.ca_id, id);
		agg_insts[id] = new aggInstn(id, msg.ag_instrumentation,
		    datakey);
	});
}

function aggCmdDisableAggregation(msg)
{
	var fqid, destkey, instn;

	destkey = msg.ca_source;

	if (!('ag_inst_id' in msg)) {
		agg_cap.sendCmdAckDisableAggFail(destkey, msg.ca_id,
		    'missing field');
		return;
	}

	fqid = msg.ag_inst_id;
	agg_cap.sendCmdAckDisableAggSuc(destkey, msg.ca_id, fqid);

	if (!(fqid in agg_insts))
		return;

	agg_log.info('disabling aggregation for instn %s', fqid);
	instn = agg_insts[fqid];
	delete (agg_insts[fqid]);
	instn.deleteData();
}

/*
 * Process AMQP status command.
 */
function aggCmdStatus(msg)
{
	var sendmsg = {};
	var id, inst;

	sendmsg.s_component = 'aggregator';
	sendmsg.s_status = aggAdminStatus();
	sendmsg.s_instrumentations = [];

	for (id in agg_insts) {
		inst = agg_insts[id];
		sendmsg.s_instrumentations.push({
		    s_inst_id: id,
		    s_since: inst.agi_since,
		    s_nsources: inst.agi_dataset.nsources(),
		    s_last: inst.agi_last,
		    s_data: undefined /* XXX */
		});
	}

	agg_cap.sendCmdAckStatus(msg.ca_source, msg.ca_id, sendmsg);
}

/*
 * Receive data.  This is what we were born to do -- this is the data hot path.
 */
function aggData(msg)
{
	var id, time, hostname, value, now;
	var inst, dataset, interval, rq, ii;

	id = msg.d_inst_id;
	time = msg.d_time;

	if (id === undefined || time === undefined) {
		agg_log.warn('dropped data message with missing field');
		return;
	}

	time = parseInt(time / 1000, 10);

	if (isNaN(time)) {
		agg_log.warn('invalid number for time: %s', msg.d_time);
		return;
	}

	inst = agg_insts[id];
	value = msg.d_value;
	hostname = msg.ca_hostname;
	now = new Date().getTime();

	if (inst === undefined) {
		agg_log.warn('dropped data message for unknown id: %s', id);
		return;
	}

	if (!aggDataFutureCheck(hostname, time, now))
		return;

	if (inst.agi_last < time)
		inst.agi_last = time;

	dataset = inst.agi_dataset;
	dataset.update(hostname, time, value);

	/*
	 * If we have all the data we're expecting for this time index, save it
	 * to the stash and then wake up HTTP requests which may now be
	 * satisfied.  We examine all of the requests waiting on data for this
	 * instrumentation and we wake up those that were waiting for data for
	 * this time index as well as those waiting for data from earlier times,
	 * on the assumption that if we got data from all instrumenters for this
	 * time, we won't some time later get data from any of them for some
	 * previous time index.
	 */
	interval = dataset.normalizeInterval(time, time);
	time = interval['start_time'];
	ASSERT.ok(dataset.nreporting(time) <= dataset.nsources(),
	    caSprintf('nreporting: %d, nsources: %d', dataset.nreporting(time),
	    dataset.nsources()));
	if (dataset.nreporting(time) < aggExpected(dataset, time))
		return;

	inst.save();
	for (ii = 0; ii < inst.agi_requests.length; ii++) {
		rq = inst.agi_requests[ii];

		if (rq.datatime + rq.duration <= time) {
			inst.agi_requests.splice(ii--, 1);
			rq.callback(id, rq.datatime, rq.duration,
			    rq.request, rq.response, now - rq.rqtime);
		}
	}
}

function aggDataFutureCheck(hostname, datatime, now)
{
	if ((datatime - agg_future_interval) * 1000 <= now)
		return (true);

	if ((hostname in agg_future_warns) &&
	    now - agg_future_warns[hostname] < agg_future_warn_interval)
		return (false);

	agg_future_warns[hostname] = now;
	agg_log.warn('dropped data from "%s" from %dms in the future (%s)',
	    hostname, datatime * 1000 - now, 'check system clocks?');
	return (false);
}

function aggNotifyConfigRestarted()
{
	agg_log.info('config service restarted');
	aggNotifyConfig();
}

/*
 * Invoked when the configuration service restarts.  Because instrumentations
 * are not yet persistent, we drop all the data we have and start again.
 */
function aggNotifyConfigReset()
{
	agg_log.info('config reset');
	agg_insts = {};
}

function aggHttpRouter(server)
{
	var infixes = [ '', 'customers/:custid/' ];
	var ii, base;

	server.get(agg_http_baseuri + 'admin/status', aggHttpAdminStatus);

	for (ii = 0; ii < infixes.length; ii++) {
		base = agg_http_baseuri + infixes[ii] +
		    'instrumentations/:instid/value';
		server.get(base, aggHttpValueList);
		server.get(base + '/raw', aggHttpValueRaw);
		server.get(base + '/heatmap', aggHttpValueHeatmapList);
		server.get(base + '/heatmap/image', aggHttpValueHeatmapImage);
		server.get(base + '/heatmap/details',
		    aggHttpValueHeatmapDetails);
	}
}

function aggAdminStatus()
{
	var start, ret, key, obj, ntotal;

	start = new Date().getTime();

	ret = {};
	ret['heap'] = process.memoryUsage();
	ret['http'] = agg_http.info();
	ret['amqp_cap'] = agg_cap.info();
	ret['sysinfo'] = agg_sysinfo;
	ret['started'] = agg_start;
	ret['uptime'] = start - agg_start;

	ret['agg_http_req_timeout'] = agg_http_req_timeout;
	ret['agg_recent_interval'] = agg_recent_interval;
	ret['agg_http_port'] = agg_http_port;
	ret['agg_profile'] = agg_profile;
	ret['agg_transforms'] = {};

	for (key in agg_transforms) {
		obj = agg_transforms[key];
		ret['agg_transforms'][key] = {
			label: obj['label'],
			types: obj['types']
		};
	}

	ntotal = 0;
	ret['agg_insts'] = {};
	for (key in agg_insts) {
		obj = agg_insts[key];

		ret['agg_insts'][key] = {
		    since: obj.agi_since,
		    uptime: start - obj.agi_since.getTime(),
		    type: obj.agi_dataset.constructor.name,
		    nsources: obj.agi_dataset.nsources(),
		    last: obj.agi_last,
		    pending_requests: obj.agi_requests.length,
		    inst: obj.agi_instrumentation
		};

		ntotal++;
	}

	ret['agg_ninsts'] = ntotal;
	ret['request_latency'] = new Date().getTime() - start;
	return (ret);
}

function aggHttpAdminStatus(request, response)
{
	response.send(HTTP.OK, aggAdminStatus());
}

var aggValueParams = {
	duration: {
	    type: 'number',
	    min: 1,
	    max: 3600
	},
	start_time: {
	    type: 'number',
	    min: 0
	}
};

/*
 * Process the request to retrieve a metric's value.
 * XXX parameter for "don't wait" or "max time to wait"?
 */
function aggHttpValueCommon(request, response, callback, default_duration,
    exact)
{
	var custid = request.params['custid'];
	var instid = request.params['instid'];
	var fqid = mod_ca.caQualifiedId(custid, instid);
	var inst, dataset, interval, now, start, duration, since;

	if (!(fqid in agg_insts)) {
		response.send(HTTP.ENOTFOUND);
		return;
	}

	inst = agg_insts[fqid];
	now = new Date().getTime();
	since = inst.agi_since.getTime();
	dataset = inst.agi_dataset;

	try {
		start = mod_ca.caHttpParam(aggValueParams, request.ca_params,
		    'start_time');
		duration = mod_ca.caHttpParam(aggValueParams, request.ca_params,
		    'duration');

		if (duration !== undefined && exact &&
		    duration != default_duration)
			throw (new caValidationError(
			    'unsupported value for "duration"'));

		if (duration === undefined)
			duration = default_duration;

		if (start === undefined)
			start = parseInt(now / 1000, 10) - duration -
			    inst.agi_instrumentation['granularity'];
		else if ((start + duration) * 1000 > now + agg_http_req_timeout)
			throw (new caValidationError(
			    'start_time + duration is in the future'));

		aggHttpVerifyTransformations(fqid, request);
	} catch (ex) {
		if (!(ex instanceof caValidationError))
			throw (ex);

		response.sendError(ex);
		return;
	}

	interval = dataset.normalizeInterval(start, duration);
	start = interval['start_time'];
	duration = interval['duration'];

	if ((start + duration) * 1000 < since ||
	    dataset.nreporting(start + duration) >=
	    aggExpected(dataset, start + duration)) {
		callback(fqid, start, duration, request, response, 0);
		return;
	}

	/*
	 * We don't have all the data we're expecting for this time index yet,
	 * but we expect to get it in the near future.  We add a record to this
	 * instrumentation's list of outstanding requests.  When new data comes
	 * in, we'll figure out if we should process this request.  There's also
	 * a timer that periodically times these out.
	 */
	inst.agi_requests.push({
	    rqtime: now,
	    datatime: start,
	    duration: duration,
	    request: request,
	    response: response,
	    callback: callback
	});
}

function aggHttpValueList(request, response)
{
	var url = request.url;
	var rv = {};

	while (url[url.length - 1] === '/')
		url = url.substring(0, url.length - 1);

	rv = [ {
		name: 'value_raw',
		uri: url + '/raw'
	} ];

	if (aggHttpValueHeatmapCheck(request)) {
		rv.push({
			name: 'value_heatmap',
			uri: url + '/heatmap'
		});
	}

	response.send(HTTP.OK, rv);
}

function aggHttpValueRaw(request, response)
{
	aggHttpValueCommon(request, response, aggHttpValueRawDone, 1, true);
}

function aggHttpValueRawDone(id, start, duration, request, response, delay)
{
	var inst = agg_insts[id];
	var dataset = inst.agi_dataset;
	var ret, keys, transform;

	ASSERT.ok(duration ==
	    dataset.normalizeInterval(start, 1)['duration']);

	ret = {};
	ret.duration = duration;
	ret.start_time = start;
	ret.nsources = dataset.nsources();
	ret.value = dataset.dataForTime(start);
	ret.minreporting = dataset.nreporting(start);

	keys = (typeof (ret.value) == 'object' &&
	    ret.value.constructor == Object) ?  Object.keys(ret.value) : [];
	transform = aggHttpValueTransform(id, request, keys);
	if (transform != null)
		ret.transformations = transform;

	if (delay > 0)
		ret.delayed = delay;

	response.send(HTTP.OK, ret);
}

/*
 * Performs validity checks on the given heatmap request.  Currently we just
 * verify that the instrumentation is of the proper type to support a heatmap.
 */
function aggHttpValueHeatmapCheck(request)
{
	var custid = request.params['custid'];
	var instid = request.params['instid'];
	var fqid = mod_ca.caQualifiedId(custid, instid);
	var inst;

	if (!(fqid in agg_insts))
		return (false);

	inst = agg_insts[fqid];
	if (inst.agi_instrumentation['value-arity'] === mod_ca.ca_arity_numeric)
		return (true);

	return (false);
}

function aggHttpValueHeatmapList(request, response)
{
	var url = request.url;
	var rv = {};

	if (!aggHttpValueHeatmapCheck(request)) {
		response.send(HTTP.ENOTFOUND);
		return;
	}

	while (url[url.length - 1] === '/')
		url = url.substring(0, url.length - 1);

	rv = [ {
		name: 'image',
		uri: url + '/image'
	}, {
		name: 'details',
		uri: url + '/details'
	} ];

	response.send(HTTP.OK, rv);
}

function aggHttpValueHeatmapImage(request, response)
{
	if (!aggHttpValueHeatmapCheck(request)) {
		response.send(HTTP.ENOTFOUND);
		return;
	}

	aggHttpValueCommon(request, response, aggHttpValueHeatmapImageDone, 60);
}

function aggHttpValueHeatmapDetails(request, response)
{
	if (!aggHttpValueHeatmapCheck(request)) {
		response.send(HTTP.ENOTFOUND);
		return;
	}

	aggHttpValueCommon(request, response, aggHttpValueHeatmapDetailsDone,
	    60);
}

var aggValueHeatmapParams = {
	height: {
	    type: 'number',
	    default: 300,
	    min: 10,
	    max: 1000
	},
	width: {
	    type: 'number',
	    default: 600,
	    min: 10,
	    max: 1000
	},
	ymin: {
	    type: 'number',
	    default: 0,
	    min: 0,
	    max: 1000000000000		/* 1000s */
	},
	ymax: {
	    type: 'number',
	    default: undefined,		/* auto-scale */
	    min: 0,
	    max: 1000000000000		/* 1000s */
	},
	nbuckets: {
	    type: 'number',
	    default: 100,
	    min: 1,
	    max: 100
	},
	selected: {
	    type: 'array',
	    default: []
	},
	isolate: {
	    type: 'boolean',
	    default: false
	},
	exclude: {
	    type: 'boolean',
	    default: false
	},
	hues: {
	    type: 'array',
	    default: undefined
	},
	weights: {
	    type: 'enum',
	    default: 'weights',
	    choices: { count: true, weight: true }
	},
	coloring: {
	    type: 'enum',
	    default: 'rank',
	    choices: { rank: true, linear: true }
	},
	decompose_all: {
	    type: 'boolean',
	    default: false
	},
	x: {
	    type: 'number',
	    required: true,
	    min: 0
	},
	y: {
	    type: 'number',
	    required: true,
	    min: 0
	}
};

function aggHttpHeatmapHues(nselected, isolate)
{
	var hues, ii;

	hues = [ 21 ];

	for (ii = 0; ii < nselected; ii++)
		hues.push((hues[hues.length - 1] + 91) % 360);

	if (isolate)
		hues.shift();

	return (hues);
}

function aggHttpHeatmapConf(request, start, duration, isolate, nselected)
{
	var conf, formals, actuals, max, nhues, hue, hues;
	var ii;

	formals = aggValueHeatmapParams;
	actuals = request.ca_params;

	conf = {};
	conf.base = start;
	conf.nsamples = duration;
	conf.height = mod_ca.caHttpParam(formals, actuals, 'height');
	conf.width = mod_ca.caHttpParam(formals, actuals, 'width');
	conf.nbuckets = mod_ca.caHttpParam(formals, actuals, 'nbuckets');
	conf.min = mod_ca.caHttpParam(formals, actuals, 'ymin');
	max = mod_ca.caHttpParam(formals, actuals, 'ymax');
	if (max !== undefined)
		conf.max = max;
	conf.weighbyrange = mod_ca.caHttpParam(formals, actuals,
	    'weights') == 'weight';
	conf.linear = mod_ca.caHttpParam(formals, actuals,
	    'coloring') == 'linear';
	hues = mod_ca.caHttpParam(formals, actuals, 'hues');

	if (conf.ymin >= conf.ymax)
		throw (new caValidationError(
		    '"ymax" must be greater than "ymin"'));

	nhues = nselected + (isolate ? 0 : 1);

	if (hues !== undefined) {
		if (nhues > hues.length)
			throw (new caValidationError(
			    'need ' + nhues + ' hues'));

		for (ii = 0; ii < hues.length; ii++) {
			hue = hues[ii] = parseInt(hues[ii], 10);

			if (isNaN(hue) || hue < 0 || hue >= 360)
				throw (new caValidationError(
				    'invalid hue'));
		}

		conf.hue = hues;
	}

	return (conf);
}

function aggHttpValueHeatmapImageDone(id, start, duration, request, response,
    delay)
{
	var conf, selected, isolate, exclude, rainbow;
	var inst, dataset, datasets, count;
	var ii, ret, transforms, buffer, png;
	var param = function (formals, key) {
		return (mod_ca.caHttpParam(formals, request.ca_params, key));
	};

	var tk = new mod_ca.caTimeKeeper();

	inst = agg_insts[id];
	dataset = inst.agi_dataset;

	try {
		selected = param(aggValueHeatmapParams, 'selected');
		isolate = param(aggValueHeatmapParams, 'isolate');
		exclude = param(aggValueHeatmapParams, 'exclude');
		rainbow = param(aggValueHeatmapParams, 'decompose_all');
		conf = aggHttpHeatmapConf(request, start, duration, isolate,
		    selected.length);

		count = 0;
		if (isolate)
			count++;
		if (exclude)
			count++;
		if (rainbow)
			count++;

		if (count > 1)
			throw (new caValidationError(
			    'only one of "isolate", "exclude", and ' +
			    '"decompose_all" may be specified'));
	} catch (ex) {
		if (!(ex instanceof caValidationError))
			throw (ex);

		response.sendError(ex);
		return;
	}

	ret = {};
	ret.start_time = start;
	ret.duration = duration;
	ret.nsources = dataset.nsources();
	ret.minreporting = dataset.nreporting(start, duration);
	ret.present = dataset.keysForTime(start, duration);

	if (rainbow)
		selected = ret.present.sort();

	if (delay > 0)
		ret.delayed = delay;

	datasets = [];
	datasets.push(dataset.total());

	for (ii = 0; ii < selected.length; ii++)
		datasets.push(dataset.dataForKey(selected[ii]));

	for (ii = 0; ii < datasets.length; ii++)
		datasets[ii] = mod_heatmap.bucketize(datasets[ii], conf);

	if (!conf.hue)
		conf.hue = aggHttpHeatmapHues(datasets.length - 1, isolate);

	if (isolate) {
		datasets.shift();

		if (datasets.length === 0) {
			datasets = [ mod_heatmap.bucketize({}, conf) ];
			conf.hue = [ 0 ];
		}
	} else {
		for (ii = 1; ii < datasets.length; ii++)
			mod_heatmap.deduct(datasets[0], datasets[ii]);

		if (exclude)
			datasets = [ datasets[0] ];
	}

	/*
	 * We can have more than the expected number of hues here because we
	 * won't always have entries for an empty dataset or because the user
	 * simply provided more hues than were necessary.
	 */
	tk.step('up to bucketize + deduction');
	ASSERT.ok(conf.hue.length >= datasets.length);
	conf.hue = conf.hue.slice(0, datasets.length);
	mod_heatmap.normalize(datasets, conf);

	conf.base = 0;
	conf.saturation = [ 0, 0.9 ];
	conf.value = 0.95;

	tk.step('normalize');
	png = mod_heatmap.generate(datasets, conf);

	tk.step('generate');
	transforms = aggHttpValueTransform(id, request, ret.present);
	if (transforms != null)
		ret.transformations = transforms;

	ret.ymin = conf.min;
	ret.ymax = conf.max;
	tk.step('transform + samplerange');
	buffer = png.encodeSync();
	tk.step('png encoding');
	ret.image = buffer.toString('base64');
	response.send(HTTP.OK, ret);
	tk.step('response sent');

	if (agg_profile)
		agg_log.dbg('%s', tk);
}

function aggHttpValueHeatmapDetailsDone(id, start, duration, request, response,
    delay)
{
	var inst, conf, detconf, xx, yy;
	var dataset, range, present, ii, ret, value;
	var param = function (formals, key) {
		return (mod_ca.caHttpParam(formals, request.ca_params, key));
	};

	inst = agg_insts[id];
	dataset = inst.agi_dataset;

	try {
		conf = aggHttpHeatmapConf(request, start, duration, false, 0);
		xx = param(aggValueHeatmapParams, 'x');
		yy = param(aggValueHeatmapParams, 'y');

		if (!conf.max)
			throw (new caValidationError(
			    '"ymax" must be specified'));

		if (xx >= conf.width)
			throw (new caValidationError(
			    '"x" must be less than "width"'));

		if (yy >= conf.height)
			throw (new caValidationError(
			    '"y" must be less than "height"'));
	} catch (ex) {
		if (!(ex instanceof caValidationError))
			throw (ex);

		response.sendError(ex);
		return;
	}

	range = mod_heatmap.samplerange(xx, yy, conf);

	ret = {};
	ret.bucket_time = range[0];
	ret.bucket_ymin = range[1][0];
	ret.bucket_ymax = range[1][1];
	ret.start_time = start;
	ret.duration = duration;
	ret.nsources = dataset.nsources();
	ret.minreporting = dataset.nreporting(range[0]);

	if (delay > 0)
		ret.delayed = delay;

	detconf = {
		base: range[0],
		min: range[1][0],
		max: range[1][1],
		nbuckets: 1,
		nsamples: 1
	};

	/*
	 * Our goal is to return the sum of values at a particular point as well
	 * as the actual decomposition of values.  Recall that these values can
	 * be fractional in cases where the underlying data included intervals
	 * larger than the bucket size because in those cases we assign the
	 * values proportionally to the buckets in the interval.  We'd rather
	 * avoid presenting this detail to the user, since it doesn't generally
	 * matter and can be rather confusing, so we always want to present
	 * integer values for both the total and decompositions.  We could
	 * simply round both the total and component values, but then we could
	 * run into paradoxical situations in which the user sees non-zero data
	 * in the heatmap but the total and components all round to zero so the
	 * decomposition contains no data.  You could also wind up in situations
	 * where the total didn't match the sum of the components because of
	 * rounding errors.  To keep our lives simple, we say that the value for
	 * each non-zero component is the maximum of 1 and the rounded value
	 * from the underlying data, and the total is defined as the sum of the
	 * components.  This works reasonably for cases where we have a
	 * decomposition; in those where we don't, we apply the same rounded-
	 * but-at-least-one rule to derive the total directly from the data.
	 */
	present = dataset.keysForTime(range[0], 1);
	ret.present = {};

	if (present.length === 0) {
		/*
		 * Maybe there's no data here, or maybe there's just no
		 * decomposition.  Either way, calculate the total separately.
		 */
		value = mod_heatmap.bucketize(dataset.total(), detconf)[0][0];
		if (value === 0)
			ret.total = 0;
		else
			ret.total = Math.max(1, Math.round(value));
	} else {
		ret.total = 0;

		for (ii = 0; ii < present.length; ii++) {
			value = mod_heatmap.bucketize(
			    dataset.dataForKey(present[ii]), detconf)[0][0];

			if (!value)
				continue;

			value = Math.max(1, Math.round(value));
			ret.present[present[ii]] = value;
			ret.total += value;
		}
	}

	response.send(HTTP.OK, ret);
}

/*
 * We define the number of sources we expect to be reporting data at a given
 * time as the number of sources that reported data "recently".  For simplicity,
 * we define "recent" as "within the interval of length 2*'timeout' ending
 * 'timeout' seconds ago.  That is, if we typically wait 5 up to seconds for an
 * instrumenter to report data, then the number of sources we expect to report
 * data now is the number of different sources that reported data between 5 and
 * 15 seconds ago.  Essentially, an instrumenter has to disappear for at least
 * 15 seconds before we stop holding client data requests for that
 * instrumenter's data.
 */
function aggExpected(dataset, time)
{
	var start, duration, interval;

	start = time - agg_http_req_timeout / 1000 - agg_recent_interval / 1000;
	duration = agg_recent_interval / 1000;
	interval = dataset.normalizeInterval(start, duration);

	return (dataset.maxreporting(
	    interval['start_time'], interval['duration']));
}

/*
 * Invoked once/second to time out old HTTP requests and expire old data.
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
				rq.callback(id, rq.datatime, rq.duration,
				    rq.request, rq.response, now - rq.rqtime);
			}
		}

		if (inst.agi_load == 'waiting' &&
		    now - inst.agi_load_last > agg_stash_load_retry) {
			inst.agi_load = 'idle';
			inst.load();
		} else if (!agg_stash_saved ||
		    agg_stash_saved - now > agg_stash_min_interval)  {
			agg_stash_saved = now;
			inst.save();
		}

		if (!inst.agi_instrumentation['retention-time'])
			continue;

		inst.agi_dataset.expireBefore(parseInt(now / 1000, 10) -
		    inst.agi_instrumentation['retention-time']);
	}

	setTimeout(aggTick, 1000);
}

/*
 * Transformation modules:
 *
 * A transformation is a post processing action that can be applied to raw data.
 * For example, one could perform geolocation or reverse DNS on data.
 *
 * A transformation module defines a single object which it uses to register
 * with the aggregator. The object contains the following four fields:
 *
 *	name			The id for this transformation as a string
 *
 *	label			The human readable name for this transformation
 *				as a string
 *
 *	fields			An array of fields that this transformation
 *				supports operating on
 *
 *	transform		A function of the form object (*transform)(raw).
 *				This takes the raw data and transforms it per
 *				the module specific transformation. It then
 *				returns the data in an object in a
 *				module-specific format.
 *
 * Data from transformations is assembled into a larger object where each key is
 * the name of the transformation and the value is the data returned from
 * calling the transform function.
 */

function aggBackendInterface() {}

/*
 * Function called to register a transformation. Args should be an object as
 * described above. We currently require that the name of each transformation be
 * unique. To indicate an error we throw an exception.
 */
aggBackendInterface.prototype.registerTransformation = function (args)
{
	var name, label, fields, transform;

	name = mod_ca.caFieldExists(args, 'name', '');
	label = mod_ca.caFieldExists(args, 'label', '');
	fields = mod_ca.caFieldExists(args, 'fields', []);
	transform = mod_ca.caFieldExists(args, 'transform',
	    aggBackendInterface);

	if (name in agg_transforms)
		throw (new caValidationError('Transformation module "' +
		    '" already declared'));

	agg_transforms[name] = {
	    label: label,
	    fields: fields,
	    transform: transform
	};
};

/*
 * Attempts to load the known transformations and add them to the set of
 * available transformations. If no transformations load successfully, it
 * barrels on. The lack of valid transformations should not stop the aggregator
 * from initializing and doing what it needs to.
 */
function aggInitBackends()
{
	var backends = [ 'geolocate', 'reversedns' ];
	var bemgr = new aggBackendInterface();
	var plugin, ii;

	for (ii = 0; ii < backends.length; ii++) {
		try {
			plugin = require('./caagg/transforms/' + backends[ii]);
			plugin.agginit(bemgr, agg_log);
			agg_log.info('Loaded transformation: ' + backends[ii]);
		} catch (ex) {
			agg_log.warn(mod_ca.caSprintf('FAILED loading ' +
			    'transformation "%s": %s', backends[ii],
			    ex.toString()));
		}
	}

	agg_log.info('Finished loading modules');
}

/*
 * Verifies that the requested transformations exist and make sense for the
 * specific aggregation.
 */
function aggHttpVerifyTransformations(id, request)
{
	var trans, ii, validtrans;

	trans = mod_ca.caHttpParam({
	    transformations: {
		type: 'array',
		default: []
	    }
	}, request.ca_params, 'transformations');

	validtrans = agg_insts[id].agi_instrumentation['transformations'];

	for (ii = 0; ii < trans.length; ii++) {
		if (!(trans[ii] in agg_transforms))
			throw (new caValidationError(mod_ca.caSprintf(
			    'Requested non-existant transformation: %s',
			    trans[ii])));


		if (!(trans[ii] in validtrans))
			throw (new caValidationError(mod_ca.caSprintf(
			    'Requested incompatible transformation: %s',
			    trans[ii])));
	}
}

/*
 * Handles fulfilling all the requested transformations. The request should
 * have previously been validated by aggHttpVerifyTransformations. We iterate
 * over each transformation and call the transform function it registered with
 * the aggregator and combine all the results into one object.
 *
 * Input Parameters:
 *
 *	id		The id for the instrumentation
 *
 *	request		The HTTP request that we are processing
 *
 *	raw		Array of keys to be transformed
 *
 * Return values:
 *
 *	If 0 transformations requested: null
 *
 *	If >0 transformations:
 *		An object where each key corresponds to a requested
 *		transformation. It will have the data for that transformation,
 *		if that transformation is valid and can be done for the specific
 *		instrumentation. Otherwise, the key will be null.
 */
function aggHttpValueTransform(id, request, raw)
{
	var ret = null;
	var trans, ii;

	trans = mod_ca.caHttpParam({
	    transformations: {
		type: 'array',
		default: []
	    }
	}, request.ca_params, 'transformations');

	if (mod_ca.caIsEmpty(trans))
		return (ret);

	ret = {};

	/*
	 * If for some reason one of our transformation backends blow up, we
	 * shouldn't abort everything because of that. We should log what
	 * happened and set their return value to be the empty object. It's
	 * important that the user still be able to get the data they requested.
	 */
	for (ii = 0; ii < trans.length; ii++) {
		try {
			ret[trans[ii]] =
			    agg_transforms[trans[ii]].transform(raw);
		} catch (ex) {
			ret[trans[ii]] = {};
			agg_log.error(mod_ca.caSprintf('EXCEPTION from ' +
			    'transform %s: %s', trans[ii], ex.toString()));
		}
	}

	return (ret);
}

/*
 * This class is not very well encapsulated.  It's primarily used as a data
 * structure for keeping track of various state associated with this
 * instrumentation, and most of the properties are exposed directly to the rest
 * of the aggregator.  The class exists (rather than using a simple Object) to
 * encapsulate the load state, which is non-trivial.
 *
 * Note that both loading and saving data is best-effort, and nothing actually
 * waits for it directly.  That's why the load() and save() entry points don't
 * consume callbacks and don't provide notification for completion or failure.
 */
function aggInstn(id, instn, datakey)
{
	this.agi_id = id;
	this.agi_since = new Date();
	this.agi_dataset = mod_caagg.caDatasetForInstrumentation(instn);
	this.agi_last = 0;
	this.agi_requests = [];
	this.agi_instrumentation = instn;
	this.agi_datakey = datakey;
	this.agi_bucket = 'ca.instn.data.' + this.agi_id;

	if (!instn['persist-data']) {
		this.agi_load = 'non-persistent';
		return;
	}

	this.agi_load = 'idle';
	this.load();
}

/*
 * Fetch and load saved data from the stash.  The load state must be 'idle',
 * which indicates that we've either never tried to load before or a previous
 * load failed (i.e. there's no load currently going on).
 */
aggInstn.prototype.load = function ()
{
	var instn, log;

	instn = this;
	log = agg_log;

	ASSERT.equal(this.agi_load, 'idle');
	this.agi_load = 'pending';

	agg_log.info('instn %s: loading from stash', this.agi_id);

	agg_cap.cmdDataGet(mod_cap.ca_amqp_key_stash, agg_stash_timeout,
	    [ { bucket: this.agi_bucket } ], function (err, results) {
		if (err) {
			/*
			 * We failed to complete the "get" command at all.
			 * We'll try again in a little while.
			 */
			instn.agi_load = 'waiting';
			instn.agi_load_last = new Date().getTime();
			log.error('instn %s stash load failed: %r',
			    instn.agi_id, err);
			return;
		}

		/*
		 * If we fail after this point, it's because the data is
		 * garbage.  We treat this as a successful load for the purposes
		 * of saving future data, meaning that we'll clobber whatever
		 * data is currently there.
		 */
		instn.agi_load = 'loaded';
		ASSERT.equal(results.length, 1);

		if ('error' in results[0]) {
			if (results[0]['error']['code'] == ECA_NOENT)
				agg_log.warn('instn %s stash load: no data',
				    instn.agi_id);
			else
				agg_log.warn('instn %s stash load: failed: %s',
				    results[0]['error']['message']);

			return;
		}

		instn.unstash(results[0]['result']);
	    });
};

/*
 * Given data saved in the stash, load it into this instrumentation's dataset.
 */
aggInstn.prototype.unstash = function (result)
{
	var metadata, contents, data;

	metadata = result['metadata'];
	contents = result['data'];

	try {
		data = JSON.parse(contents);
		agg_log.info('instn %s stash load: found results from %j',
		    this.agi_id, metadata.ca_creator);
		this.agi_dataset.unstash(metadata, data);
	} catch (ex) {
		agg_log.warn('instn %s stash load: failed to parse results: %r',
		    this.agi_id, ex);
	}
};

/*
 * Save the current state to the stash, but only if it hasn't been saved too
 * recently and we're not currently trying to save it.
 */
aggInstn.prototype.save = function ()
{
	var instn, now, rq;

	/*
	 * Non-persistent instrumentations don't get saved.
	 */
	if (this.agi_load == 'non-persistent')
		return;

	/*
	 * If we're already saving, don't try to save again.
	 */
	if (this.agi_saving)
		return;

	/*
	 * If we haven't loaded anything from the persistence service, don't
	 * save what we've got.  Otherwise, we might clobber what's there just
	 * because we didn't load it yet (perhaps because the stash was
	 * experiencing problems when we started up).
	 */
	if (this.agi_load != 'loaded')
		return;

	now = new Date().getTime();

	if (this.agi_last_saved) {
		if (now - this.agi_last_saved < agg_stash_min_interval)
			return;

		if (now - this.agi_last_saved <
		    this.agi_instrumentation['granularity'] * 1000)
			return;
	}

	instn = this;
	rq = this.agi_dataset.stash();
	rq['bucket'] = this.agi_bucket;
	rq['data'] = JSON.stringify(rq['data']);
	rq['metadata'].ca_creator = agg_sysinfo;

	agg_log.dbg('instn %s: saving to stash', instn.agi_id);

	this.agi_saving = true;
	agg_cap.cmdDataPut(mod_cap.ca_amqp_key_stash, agg_stash_timeout,
	    [ rq ], function (err, results) {
		instn.agi_saving = false;

		if (err) {
			agg_log.error('instn %s stash save failed: %r',
			    instn.agi_id, err);
			return;
		}

		if ('error' in results[0]) {
			agg_log.error('instn %s stash save failed remotely: %s',
			    instn.agi_id, results[0]['error']['message']);
			return;
		}

		instn.agi_last_saved = now;
	    });
};

aggInstn.prototype.update = function (newinst, datakey)
{
	if (datakey != this.agi_datakey) {
		agg_log.error('asked to re-aggregate instn "%s" with ' +
		    'different datakey (was "%s", now "%s")', this.agi_id,
		    this.agi_datakey, datakey);
	}

	this.agi_instrumentation = newinst;
	if (newinst['persist-data'] && this.agi_load == 'non-persistent') {
		this.agi_load = 'idle';
		this.load();
		return;
	}

	if (!newinst['persist-data'] && this.agi_load != 'non-persistent') {
		this.agi_load = 'non-persistent';
		this.deleteData();
	}
};

aggInstn.prototype.deleteData = function ()
{
	var instn = this;

	agg_cap.cmdDataDelete(mod_cap.ca_amqp_key_stash, agg_stash_timeout,
	    [ { bucket: this.agi_bucket } ], function (err, results) {
		if (err) {
			agg_log.error('instn %s stash delete failed: %r',
			    instn.agi_id, err);
			return;
		}

		if ('error' in results[0]) {
			agg_log.error('instn %s stash delete failed ' +
			    'remotely: %s', instn.agi_id,
			    results[0]['error']['message']);
			return;
		}

		agg_log.info('instn %s data deleted', instn.agi_id);
	    });
};

main();
