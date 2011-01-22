/*
 * caaggsvc: Cloud Analytics Aggregator/Retriever service
 */

var mod_ca = require('../lib/ca/ca-common');
var mod_caamqp = require('../lib/ca/ca-amqp');
var mod_cap = require('../lib/ca/ca-amqp-cap');
var mod_cahttp = require('../lib/ca/ca-http');
var mod_log = require('../lib/ca/ca-log');
var mod_heatmap = require('heatmap');
var HTTP = require('../lib/ca/http-constants');
var ASSERT = require('assert');

var agg_name = 'aggsvc';		/* component name */
var agg_vers = '0.0';			/* component version */
var agg_http_req_timeout = 5000;	/* max milliseconds to wait for data */
var agg_http_baseuri = '/ca/';
var agg_http_port_base = mod_ca.ca_http_port_agg_base;
var agg_http_port;			/* actual http port */

var agg_insts = {};		/* active instrumentations by id */
var agg_default_options = { 'enabled': true, 'retention-time': 600 };

var agg_http;
var agg_cap;			/* cap wrapper */
var agg_log;			/* log handle */

function main()
{
	var http_port_base = agg_http_port_base;
	var broker = mod_ca.caBroker();
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
	    bindings: [ 'ca.broadcast' ]
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
	agg_cap.on('msg-notify-configsvc_online', aggNotifyConfigRestarted);

	agg_log.info('Aggregator starting up (%s/%s)', agg_name, agg_vers);
	agg_log.info('%-12s %s', 'Hostname:', hostname);
	agg_log.info('%-12s %s', 'AMQP broker:', JSON.stringify(broker));
	agg_log.info('%-12s %s', 'Routing key:', amqp.routekey());

	agg_http = new mod_cahttp.caHttpServer({
	    log: agg_log,
	    port_base: http_port_base,
	    router: aggHttpRouter
	});

	agg_http.start(function () {
	    agg_http_port = agg_http.port();
	    agg_log.info('%-12s Port %d (started)',
		'HTTP server:', agg_http_port);
	    amqp.start(aggStarted);
	    setTimeout(aggTick, 1000);
	});
}

function aggNotifyConfig()
{
	agg_cap.sendNotifyAggOnline(mod_ca.ca_amqp_key_config, agg_http_port);
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
	var dimension;

	if (!('ag_inst_id' in msg) || !('ag_key' in msg) ||
	    !('ag_dimension' in msg)) {
		agg_cap.sendCmdAckEnableAggFail(destkey, msg.ca_id,
		    'missing field');
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
		agg_insts[id].agi_options = msg.ag_options ||
		    agg_default_options;
		agg_cap.sendCmdAckEnableAggSuc(destkey, msg.ca_id, id);
		return;
	}

	agg_cap.bind(datakey, function () {
	    agg_log.info('aggregating instrumentation %s', id);
	    agg_insts[id] = {
		agi_dimension: dimension,
		agi_since: new Date(),
		agi_sources: { sources: {}, nsources: 0 },
		agi_values: {},
		agi_last: 0,
		agi_requests: [],
		agi_options: msg.ag_options || agg_default_options
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

	agg_cap.sendCmdAckStatus(msg.ca_source, msg.ca_id, sendmsg);
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

	if (id === undefined || time === undefined) {
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
		aggAggregateValue(inst.agi_values[time], 'value', value);
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
	if (inst.agi_values[time].count != inst.agi_sources.nsources)
		return;

	for (ii = 0; ii < inst.agi_requests.length; ii++) {
		rq = inst.agi_requests[ii];

		if (rq.datatime <= time) {
			inst.agi_requests.splice(ii--, 1);
			rq.callback(id, rq.datatime, rq.request, rq.response);
		}
	}
}

function aggAggregateScalar(map, key, value)
{
	if (!(key in map) || map[key] === undefined)
		map[key] = 0;

	map[key] += value;
	ASSERT.ok(typeof (map[key]) == 'number');
	ASSERT.ok(typeof (value) == 'number');
}

function aggAggregateDistribution(map, key, newdist)
{
	var olddist, oo, nn;

	ASSERT.ok(newdist.constructor == Array);

	if (!(key in map) || map[key] === undefined)
		map[key] = [];

	olddist = map[key];
	ASSERT.ok(olddist.constructor == Array);

	/*
	 * We assume here that the ranges from both distributions exactly align
	 * (which is currently true since we use fixed lquantize() parameters on
	 * the backend) and that the ranges are sorted in both distributions.
	 */
	for (oo = 0, nn = 0; nn < newdist.length; nn++) {
		/*
		 * Scan the old distribution until we find a range not before
		 * the current range from the new distribution.
		 */
		while (oo < olddist.length &&
		    olddist[oo][0][0] < newdist[nn][0][0]) {
			ASSERT.ok(olddist[oo][0][1] < newdist[nn][0][1]);
			oo++;
		}

		/*
		 * If we found a range that matched exactly, just add the
		 * values. XXX should this be aggAggregateValue instead?
		 */
		if (oo < olddist.length &&
		    olddist[oo][0][0] == newdist[nn][0][0]) {
			ASSERT.ok(olddist[oo][0][1] == newdist[nn][0][1]);
			olddist[oo][1] += newdist[nn][1];
			continue;
		}

		/*
		 * The current range in the new distribution doesn't match any
		 * existing range in the old distribution, so just insert the
		 * new data point wherever we are (which may be the end of the
		 * old distribution).  We create a new data point consisting of
		 * a reference to the range in the new distribution (ranges are
		 * immutable) and a copy of the range's value.
		 */
		olddist.splice(oo, 0, [ newdist[nn][0], newdist[nn][1] ]);
	}
}

function aggAggregateValue(map, key, value)
{
	var subkey;

	if (value === undefined)
		return;

	if (typeof (value) == 'number') {
		aggAggregateScalar(map, key, value);
		return;
	}

	if (value.constructor == Array) {
		aggAggregateDistribution(map, key, value);
		return;
	}

	ASSERT.ok(value.constructor == Object);

	for (subkey in value) {
		if (!(key in map) || map[key] === undefined)
			map[key] = {};
		aggAggregateValue(map[key], subkey, value[subkey]);
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

	for (ii = 0; ii < infixes.length; ii++) {
		base = agg_http_baseuri + infixes[ii] +
		    'instrumentations/:instid/value/';
		server.get(base + 'raw', aggHttpValueRaw);
		server.get(base + 'heatmap', aggHttpValueHeatmap);
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
function aggHttpValueCommon(request, response, callback)
{
	var custid = request.params['custid'];
	var instid = request.params['instid'];
	var fqid = mod_ca.caQualifiedId(custid, instid);
	var inst, now, record, start, since, err;

	if (!(fqid in agg_insts)) {
		response.send(HTTP.ENOTFOUND);
		return;
	}

	inst = agg_insts[fqid];
	now = new Date().getTime();
	if ('start_time' in request.ca_params) {
		start = parseInt(request.ca_params['start_time'], 10);
		since = parseInt(inst.agi_since.getTime() / 1000, 10);
		err = {};
		err.found = false;
		if (isNaN(start)) {
			err.found = true;
			err.msg = 'start_time must be an integer';
		} else if (start < since) {
			err.found = true;
			err.msg = 'start_time must be after instrumentation ' +
			'began';
		} else if (start > parseInt(now/1000, 10) +
				agg_http_req_timeout) {
			err.found = true;
			err.msg = 'start_time is too far in the future';
		}

		if (err.found) {
			response.send(HTTP.EBADREQUEST, { error: err.msg });
			return;
		}
	} else {
		start = parseInt(now / 1000, 10) - 2;
	}

	record = inst.agi_values[start];

	if (record && record.count == inst.agi_sources.nsources) {
		callback(fqid, start, request, response);
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
	    request: request,
	    response: response,
	    callback: callback
	});
}

function aggHttpValueRaw(request, response)
{
	aggHttpValueCommon(request, response, aggHttpValueRawDone);
}

function aggHttpValueRawDone(id, when, request, response)
{
	var inst = agg_insts[id];
	var record = inst.agi_values[when];
	var zero = inst.agi_dimension > 1 ? {} : 0;
	var ret;

	ret = {};
	ret.when = when;
	ret.nsources = inst.agi_sources.nsources;

	if (record) {
		ret.value = record.value !== undefined ? record.value : zero;
		ret.nreporting = record.count;
	} else {
		ret.value = zero;
		ret.nreporting = 0;
	}

	response.send(HTTP.OK, ret);
}

function aggHttpValueHeatmap(request, response)
{
	/* XXX return 404 for non-heatmap stats? */
	aggHttpValueCommon(request, response, aggHttpValueHeatmapDone);
}

/*
 * This complex helper function deserves some explanation.  aggExtractDatasets
 * converts raw data from an instrumentation into a list of datasets to be shown
 * on the heatmap and a set of values present in the heatmap.
 *
 * The input parameters are:
 *
 *	data		Represents the raw data for a heatmap-capable
 *			instrumentation over a particular period of time
 *			corresponding to a user request.
 *
 *	selected	An array of selected values.  This can only be non-empty
 *			if the instrumentation contains a decomposition by a
 *			discrete field, in which case the members of 'selected'
 *			are particular values of the field that the user wants
 *			broken out separately.
 *
 *	dimension	Dimensionality of the instrumentation.  Tells us whether
 *			there's a discrete decomposition or not.
 *
 * This function returns an object with the following fields:
 *
 *	data		An array of datasets that's a precursor to the heatmap
 *			input. Basically, each element corresponds to a set of
 *			data points that will be drawn with a unique hue on the
 *			heatmap.  The first element represents all points on the
 *			heatmap, and subsequent elements represents points
 *			corresponding to selected fields.  (The caller will
 *			deduct these from the first element when it actually
 *			draws the heatmap.)
 *
 *	present		If the instrumentation contains no discrete
 *			decomposition, this object is empty.  If it does, this
 *			object's keys represent the set of values for the
 *			discrete decomposed field which have non-zero components
 *			anywhere in the resulting heatmap.
 */
function aggExtractDatasets(data, selected, dimension)
{
	var totals, decomposed, present;
	var retdata, time, ii, key;

	/*
	 * We can only be invoked for heatmaps (implies dimension >= 2) and we
	 * don't support more than 2 decompositions (implies dimension <= 3).
	 */
	ASSERT.ok(dimension == 2 || dimension == 3);

	/*
	 * Regardless of anything else, if there's no data for this
	 * instrumentation then there's exactly one dataset which is empty and
	 * no fields are present.
	 */
	if (mod_ca.caIsEmpty(data))
		return ({ data: [ {} ], present: {} });

	/*
	 * The next simplest case is where there's no additional discrete
	 * decomposition.  Recall that this function is only ever invoked in the
	 * heatmap case, so the instrumentation must be a numeric decomposition,
	 * so it has dimension at least 2.  If there's no discrete
	 * decomposition, then dimension == 2.  In that case, there's exactly
	 * one dataset containing all of the points and no broken-out values are
	 * present.
	 */
	if (dimension == 2)
		return ({ data: [ data ], present: {} });

	/*
	 * We have a discrete decomposition field.  If the user has selected
	 * particular values of that field, we'll have to go extract their
	 * components and return them as separate datasets.  But whether or not
	 * any values are selected we must calculate the totals and present
	 * values by looking at the component values for each field.
	 */
	retdata = [];
	totals = {};
	present = {};

	for (time in data) {
		totals[time] = [];

		for (key in data[time]) {
			present[key] = true;
			aggAggregateDistribution(totals, time,
			    data[time][key]);
		}
	}

	retdata.push(totals);

	/*
	 * If there are zero fields selected, we're done.  Just return one
	 * dataset representing the totals and the set of present fields we just
	 * computed.
	 */
	if (selected.length === 0)
		return ({ data: retdata, present: present });

	/*
	 * In this case the user has actually selected some values so we must
	 * extract those as separate datasets.
	 */
	decomposed = {};
	for (ii = 0; ii < selected.length; ii++)
		decomposed[selected[ii]] = {};

	for (time in data) {
		for (key in decomposed) {
			if (key in data[time])
				decomposed[key][time] = data[time][key];
		}
	}

	for (ii = 0; ii < selected.length; ii++) {
		key = selected[ii];
		if (key in decomposed) {
			retdata.push(decomposed[key]);
			delete (decomposed[key]);
		}
	}

	return ({ data: retdata, present: present });
}

var aggHeatmapParams = {
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
	    max: 100000
	},
	ymax: {
	    type: 'number',
	    default: 100000,
	    min: 0,
	    max: 100000
	},
	nbuckets: {
	    type: 'number',
	    default: 100,
	    min: 1,
	    max: 100
	},
	duration: {
	    type: 'number',
	    default: 60,
	    min: 1,
	    max: 600
	},
	selected: {
	    type: 'array',
	    default: []
	},
	isolate: {
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
	}
};

function aggHeatmapParam(request, param)
{
	var decl, value, errtail;

	ASSERT.ok(param in aggHeatmapParams);
	decl = aggHeatmapParams[param];

	if (!(param in request.ca_params))
		return (decl.default);

	errtail = ' for param "' + param + '"';

	switch (decl.type) {
	case 'number':
		value = parseInt(request.ca_params[param], 10);

		if (isNaN(value))
			throw (new Error('illegal value' + errtail));

		if (value < decl.min)
			throw (new Error('value too small' + errtail));

		if (value > decl.max)
			throw (new Error('value too large' + errtail));

		break;

	case 'boolean':
		value = request.ca_params[param];
		switch (value) {
		case 'true':
			value = true;
			break;
		case 'false':
			value = false;
			break;
		default:
			throw (new Error('invalid boolean' + errtail));
		}

		break;

	case 'array':
		value = request.ca_params[param];

		if (typeof (value) == 'string')
			value = value.split(',');
		else
			ASSERT.ok(value.constructor == Array);

		break;

	case 'enum':
		value = request.ca_params[param];

		if (!(value in decl.choices))
			throw (new Error('invalid choice' + errtail));

		break;

	default:
		throw (new Error('invalid type: ' + decl.type));
	}

	return (value);
}

function aggHttpValueHeatmapDone(id, when, request, response)
{
	/*
	 * XXX the way this is coded now, 'when' is the last data point, but it
	 * should really be the first one (but it's the last one we need to make
	 * sure is present).
	 */
	var inst = agg_insts[id];
	var record, rawdata, agg, nreporting;
	var datasets, png, conf, range;
	var height, width, ymin, ymax, nbuckets, duration, selected, isolate;
	var weights, coloring;
	var nhues, hues, hue;
	var ii, ret;

	try {
		height = aggHeatmapParam(request, 'height');
		width = aggHeatmapParam(request, 'width');
		ymin = aggHeatmapParam(request, 'ymin');
		ymax = aggHeatmapParam(request, 'ymax');
		nbuckets = aggHeatmapParam(request, 'nbuckets');
		duration = aggHeatmapParam(request, 'duration');
		selected = aggHeatmapParam(request, 'selected');
		isolate = aggHeatmapParam(request, 'isolate');
		hues = aggHeatmapParam(request, 'hues');
		weights = aggHeatmapParam(request, 'weights');
		coloring = aggHeatmapParam(request, 'coloring');

		if (ymin >= ymax)
			throw (new Error('"max" must be greater than "min"'));

		nhues = selected.length + (isolate ? 0 : 1);

		if (hues !== undefined) {
			if (nhues > hues.length)
				throw (new Error('need ' + nhues + ' hues'));

			for (ii = 0; ii < hues.length; ii++) {
				hue = hues[ii] = parseInt(hues[ii], 10);

				if (isNaN(hue) || hue < 0 || hue >= 360)
					throw (new Error('invalid hue'));
			}
		} else {
			hues = [ 21 ];
			for (ii = 0; ii < selected.length; ii++)
				hues.push((hues[hues.length - 1] + 91) % 360);

			if (isolate)
				hues.shift();
		}
	} catch (ex) {
		agg_log.exception(ex);
		response.send(HTTP.EBADREQUEST, { error: ex.message });
		return;
	}

	rawdata = {};

	for (ii = when - duration + 1; ii <= when; ii++) {
		record = inst.agi_values[ii];

		if (!record)
			continue;

		if (nreporting === undefined || record < nreporting)
			nreporting = record.count;

		/* XXX only need to copy if mod_heatmap changes data in place */
		rawdata[ii] = mod_ca.caDeepCopy(record.value);
	}

	conf = {
		weighbyrange: weights == 'weight',
		linear: coloring == 'linear',
		min: ymin,
		max: ymax,
		width: width,
		height: height,
		nbuckets: nbuckets,
		base: when - duration,
		nsamples: duration
	};

	agg = aggExtractDatasets(rawdata, selected, inst.agi_dimension);
	datasets = [];
	for (ii = 0; ii < agg.data.length; ii++)
		datasets.push(mod_heatmap.bucketize(agg.data[ii], conf));

	if (isolate) {
		datasets.shift();

		if (datasets.length === 0) {
			datasets = [ mod_heatmap.bucketize({}, conf) ];
			hues = [ 0 ];
		}
	} else {
		for (ii = 1; ii < datasets.length; ii++)
			mod_heatmap.deduct(datasets[0], datasets[ii]);
	}

	/*
	 * We can have more than the expected number of hues here because we
	 * won't always have entries for an empty dataset or because the user
	 * simply provided more hues than were necessary.
	 */
	ASSERT.ok(hues.length >= datasets.length);
	hues = hues.slice(0, datasets.length);
	mod_heatmap.normalize(datasets, conf);

	conf.hue = hues;
	conf.saturation = [ 0, 0.9 ];
	conf.value = 0.95;

	png = mod_heatmap.generate(datasets, conf);
	range = mod_heatmap.samplerange(0, 0, conf);

	conf = {
		min: range[1][0],
		max: range[1][1],
		nbuckets: 1,
		base: range[0],
		nsamples: 1
	};

	ret = {};
	ret.sample = conf.base;
	ret.min = conf.min;
	ret.max = conf.max;
	ret.total = Math.round(mod_heatmap.bucketize(agg.data[0], conf)[0][0]);
	ret.minreporting = nreporting;
	ret.when = when;
	ret.present = agg.present;
	png.encode(function (png_data) {
		ret.image = png_data.toString('base64');
		response.send(HTTP.OK, ret);
	});
}

/*
 * Invoked once/second to time out old HTTP requests and expire old data.
 */
function aggTick()
{
	var id, inst, ii, rq, when;
	var now = new Date().getTime();

	for (id in agg_insts) {
		inst = agg_insts[id];
		for (ii = 0; ii < inst.agi_requests.length; ii++) {
			rq = inst.agi_requests[ii];

			ASSERT.ok(rq.rqtime <= now);

			if (now - rq.rqtime >= agg_http_req_timeout) {
				inst.agi_requests.splice(ii--, 1);
				rq.callback(id, rq.datatime, rq.request,
				    rq.response);
			}
		}

		for (when in inst.agi_values) {
			if (inst.agi_options['retention-time'] > 0 &&
			    now - (when * 1000) >
			    inst.agi_options['retention-time'] * 1000)
				delete (inst.agi_values[when]);
		}
	}

	setTimeout(aggTick, 1000);
}

main();
