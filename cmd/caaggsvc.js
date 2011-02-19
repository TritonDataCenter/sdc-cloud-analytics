/*
 * caaggsvc: Cloud Analytics Aggregator/Retriever service
 */

var mod_ca = require('../lib/ca/ca-common');
var mod_caagg = require('../lib/ca/ca-agg.js');
var mod_caamqp = require('../lib/ca/ca-amqp');
var mod_caerr = require('../lib/ca/ca-error');
var mod_cap = require('../lib/ca/ca-amqp-cap');
var mod_cahttp = require('../lib/ca/ca-http');
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
var agg_http_port;			/* actual http port */
var agg_profile = false;

var agg_insts = {};		/* active instrumentations by id */
var agg_start;			/* start time (in ms) */
var agg_http;			/* http server */
var agg_amqp;			/* AMQP handle */
var agg_cap;			/* cap wrapper */
var agg_log;			/* log handle */
var agg_sysinfo;		/* system info config */
var agg_broker;			/* AMQP broker config */

var agg_transforms = {};	/* available transformations by name */

function main()
{
	agg_start = new Date().getTime();
	agg_sysinfo = mod_ca.caSysinfo(agg_name, agg_vers);
	agg_broker = mod_ca.caBroker();

	agg_log = new mod_log.caLog({ out: process.stdout });

	agg_amqp = new mod_caamqp.caAmqp({
	    broker: agg_broker,
	    exchange: mod_ca.ca_amqp_exchange,
	    exchange_opts: mod_ca.ca_amqp_exchange_opts,
	    basename: mod_ca.ca_amqp_key_base_aggregator,
	    hostname: agg_sysinfo.ca_hostname,
	    bindings: [ mod_ca.ca_amqp_key_all ]
	});
	agg_amqp.on('amqp-error', mod_caamqp.caAmqpLogError);
	agg_amqp.on('amqp-fatal', mod_caamqp.caAmqpFatalError);

	agg_cap = new mod_cap.capAmqpCap({
	    amqp: agg_amqp,
	    log: agg_log,
	    sysinfo: agg_sysinfo
	});
	agg_cap.on('msg-cmd-ping', aggCmdPing);
	agg_cap.on('msg-cmd-status', aggCmdStatus);
	agg_cap.on('msg-cmd-enable_aggregation', aggCmdEnableAggregation);
	agg_cap.on('msg-data', aggData);
	agg_cap.on('msg-notify-configsvc_online', aggNotifyConfigRestarted);

	agg_log.info('Aggregator starting up (%s/%s)', agg_name, agg_vers);
	agg_log.info('%-12s %s', 'Hostname:', agg_sysinfo.ca_hostname);
	agg_log.info('%-12s %s', 'AMQP broker:', JSON.stringify(agg_broker));
	agg_log.info('%-12s %s', 'Routing key:', agg_amqp.routekey());

	aggInitBackends();

	agg_http = new mod_cahttp.caHttpServer({
	    log: agg_log,
	    port_base: agg_http_port_base,
	    router: aggHttpRouter
	});

	agg_http.start(function () {
	    agg_http_port = agg_http.port();
	    agg_log.info('%-12s Port %d (started)',
		'HTTP server:', agg_http_port);
	    agg_amqp.start(aggStarted);
	    setTimeout(aggTick, 1000);
	});
}

function aggNotifyConfig()
{
	agg_cap.sendNotifyAggOnline(mod_ca.ca_amqp_key_config, agg_http_port,
	    agg_transforms);
}

function aggStarted()
{
	agg_log.info('AMQP broker connected.');
	/* XXX should we send this periodically too?  every 5 min or whatever */
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
		/* XXX check against key */
		agg_insts[id].agi_instrumentation = msg.ag_instrumentation;
		agg_cap.sendCmdAckEnableAggSuc(destkey, msg.ca_id, id);
		return;
	}

	agg_cap.bind(datakey, function () {
	    var inst = msg.ag_instrumentation;
	    agg_log.info('aggregating instrumentation %s', id);
	    agg_insts[id] = {
		agi_since: new Date(),
		agi_dataset: mod_caagg.caDatasetForInstrumentation(inst),
		agi_last: 0,
		agi_requests: [],
		agi_instrumentation: inst
	    };
	    agg_cap.sendCmdAckEnableAggSuc(destkey, msg.ca_id, id);
	});
}

/*
 * Process AMQP ping command.
 */
function aggCmdPing(msg)
{
	agg_cap.sendCmdAckPing(msg.ca_source, msg.ca_id);
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
	var id, time, hostname, value;
	var inst, dataset, rq, ii;

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

	if (inst === undefined) {
		agg_log.warn('dropped data message for unknown id: %s', id);
		return;
	}

	if (inst.agi_last < time)
		inst.agi_last = time;

	inst.agi_dataset.update(hostname, time, value);

	/*
	 * If we have all the data we're expecting for this time index, wake up
	 * HTTP requests which may now be satisfied.  We examine all of the
	 * requests waiting on data for this instrumentation and we wake up
	 * those that were waiting for data for this time index as well as those
	 * waiting for data from earlier times, on the assumption that if we got
	 * data from all instrumenters for this time, we won't some time later
	 * get data from any of them for some previous time index.
	 */
	dataset = inst.agi_dataset;
	ASSERT.ok(dataset.nreporting(time) <= dataset.nsources());
	if (dataset.nreporting(time) != dataset.nsources())
		return;

	for (ii = 0; ii < inst.agi_requests.length; ii++) {
		rq = inst.agi_requests[ii];

		if (rq.datatime + rq.duration <= time) {
			inst.agi_requests.splice(ii--, 1);
			rq.callback(id, rq.datatime, rq.request, rq.response);
		}
	}
}

/*
 * Invoked when the configuration service restarts.  Because instrumentations
 * are not yet persistent, we drop all the data we have and start again.
 */
function aggNotifyConfigRestarted()
{
	agg_insts = {};
	agg_log.info('config service restarted');
	aggNotifyConfig();
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
	ret['amqp_broker'] = agg_broker;
	ret['amqp_routekey'] = agg_amqp.routekey();
	ret['heap'] = process.memoryUsage();
	ret['http'] = agg_http.info();
	ret['sysinfo'] = agg_sysinfo;
	ret['started'] = agg_start;
	ret['uptime'] = start - agg_start;

	ret['agg_http_req_timeout'] = agg_http_req_timeout;
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
		    pending_requests: obj.agi_requests,
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
	var inst, dataset, now, start, duration, since;

	if (!(fqid in agg_insts)) {
		response.send(HTTP.ENOTFOUND);
		return;
	}

	inst = agg_insts[fqid];
	now = new Date().getTime();
	since = inst.agi_since.getTime();

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
			start = parseInt(now / 1000, 10) - duration - 1;
		else if ((start + duration) * 1000 > now + agg_http_req_timeout)
			throw (new caValidationError(
			    'start_time + duration is in the future'));

		aggHttpVerifyTransformations(fqid, request);
	} catch (ex) {
		if (!(ex instanceof caValidationError))
			throw (ex);

		response.send(HTTP.EBADREQUEST, { error: ex.message });
		return;
	}

	dataset = inst.agi_dataset;
	if ((start + duration) * 1000 < since ||
	    dataset.nreporting(start + duration - 1) == dataset.nsources()) {
		callback(fqid, start, request, response, 0);
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

function aggHttpValueRawDone(id, when, request, response, delay)
{
	var inst = agg_insts[id];
	var dataset = inst.agi_dataset;
	var ret, keys, transform;

	ret = {};
	ret.duration = 1;
	ret.start_time = when;
	ret.nsources = dataset.nsources();
	ret.value = dataset.dataForTime(when);
	ret.minreporting = dataset.nreporting(when);

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

function aggHttpValueHeatmapImageDone(id, start, request, response, delay)
{
	var conf, duration, selected, isolate, exclude, rainbow;
	var inst, dataset, datasets, count;
	var ii, ret, range, transforms, buffer, png;
	var param = function (formals, key) {
		return (mod_ca.caHttpParam(formals, request.ca_params, key));
	};

	var tk = new mod_ca.caTimeKeeper();

	inst = agg_insts[id];
	dataset = inst.agi_dataset;

	try {
		duration = param(aggValueParams, 'duration') || 60;
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

		response.send(HTTP.EBADREQUEST, { error: ex.message });
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

	conf.nbuckets = 1;
	range = mod_heatmap.samplerange(0, 0, conf)[1];
	ret.ymin = range[0];
	ret.ymax = range[1];
	tk.step('transform + samplerange');
	buffer = png.encodeSync();
	tk.step('png encoding');
	ret.image = buffer.toString('base64');
	response.send(HTTP.OK, ret);
	tk.step('response sent');

	if (agg_profile)
		agg_log.dbg('%s', tk);
}

function aggHttpValueHeatmapDetailsDone(id, start, request, response, delay)
{
	var inst, conf, detconf, duration, xx, yy;
	var dataset, range, present, ii, ret, bb;
	var param = function (formals, key) {
		return (mod_ca.caHttpParam(formals, request.ca_params, key));
	};

	inst = agg_insts[id];
	dataset = inst.agi_dataset;

	try {
		duration = param(aggValueParams, 'duration') || 60;
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

		response.send(HTTP.EBADREQUEST, { error: ex.message });
		return;
	}

	range = mod_heatmap.samplerange(xx, yy, conf);

	ret = {};
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

	ret.total = Math.round(mod_heatmap.bucketize(
	    dataset.total(), detconf)[0][0]);
	ret.present = {};

	if (ret.total !== 0) {
		present = dataset.keysForTime(range[0], 1);

		for (ii = 0; ii < present.length; ii++) {
			bb = mod_heatmap.bucketize(
			    dataset.dataForKey(present[ii]), detconf);

			if (bb.length === 0)
				continue;

			bb = Math.round(bb[0][0]);

			if (bb > 0)
				ret.present[present[ii]] = bb;
		}
	}

	response.send(HTTP.OK, ret);
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
				rq.callback(id, rq.datatime, rq.request,
				    rq.response, now - rq.rqtime);
			}
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
 *	types			An array of types that this transformation
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
	var name, label, types, transform;

	name = mod_ca.caFieldExists(args, 'name', '');
	label = mod_ca.caFieldExists(args, 'label', '');
	types = mod_ca.caFieldExists(args, 'types', []);
	transform = mod_ca.caFieldExists(args, 'transform',
	    aggBackendInterface);

	if (name in agg_transforms)
		throw (new caValidationError('Transformation module "' +
		    '" already declared'));

	agg_transforms[name] = {
	    label: label,
	    types: types,
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

	validtrans = agg_insts[id]['agi_instrumentation']['transformations'];

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

main();
