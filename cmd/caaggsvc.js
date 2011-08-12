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
var agg_stash_saved = 0;				/* last global save */

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
		agg_insts[id].update(msg.ag_instrumentation, datakey);
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

	if (dataset.nreporting(time) < aggExpected(dataset, time))
		return;

	inst.save();

	for (ii = 0; ii < inst.agi_requests.length; ii++) {
		rq = inst.agi_requests[ii];

		if (rq.latest() <= time) {
			inst.agi_requests.splice(ii--, 1);
			rq.complete(now);
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
	var id, inst, ii, rq, globalsave;
	var now = new Date().getTime();

	if (agg_stash_saved - now > agg_stash_min_interval) {
		globalsave = true;
		agg_stash_saved = now;
	} else {
		globalsave = false;
	}

	for (id in agg_insts) {
		inst = agg_insts[id];

		for (ii = 0; ii < inst.agi_requests.length; ii++) {
			rq = inst.agi_requests[ii];

			ASSERT.ok(rq.rqtime() <= now);

			if (now - rq.rqtime() >= rq.timeout()) {
				inst.agi_requests.splice(ii--, 1);
				rq.complete(now);
			}
		}

		if (inst.agi_load == 'waiting' &&
		    now - inst.agi_load_last > agg_stash_load_retry) {
			inst.agi_load = 'idle';
			inst.load();
		} else if (globalsave) {
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
	this.agi_dataset.updateSources(newinst['nsources']);

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

/*
 * Registers handlers for all of the HTTP resources we service.
 */
function aggHttpRouter(server)
{
	var infixes = [ '', 'customers/:custid/' ];
	var ii, base;

	server.get(agg_http_baseuri + 'admin/status', aggHttpAdminStatus);

	for (ii = 0; ii < infixes.length; ii++) {
		base = agg_http_baseuri + infixes[ii] +
		    'instrumentations/:instid/value';
		server.get(base, aggHttpValueList);
		server.get(base + '/heatmap', aggHttpValueHeatmapList);

		server.get(base + '/raw', aggHttpValueRetrieve.bind(
		    null, mod_caagg.caAggrRawImpl));
		server.get(base + '/heatmap/image', aggHttpValueRetrieve.bind(
		    null, mod_caagg.caAggrHeatmapImageImpl));
		server.get(base + '/heatmap/details', aggHttpValueRetrieve.bind(
		    null, mod_caagg.caAggrHeatmapDetailsImpl));
		server.get(base + '/heatmap/average', aggHttpValueRetrieve.bind(
		    null, mod_caagg.caAggrHeatmapAverageImpl));
		server.get(base + '/heatmap/percentile',
		    aggHttpValueRetrieve.bind(null,
		    mod_caagg.caAggrHeatmapPercentileImpl));
	}
}

/*
 * Given an HTTP request/response for a per-instrumentation resource, returns
 * the instrumentation specified in the request.  If that instrumentation does
 * not exist, responds with a 404 error and returns false.
 */
function aggHttpInstn(request, response)
{
	var custid, instid, fqid;
	var iarity, igran, dataset, instn;

	custid = request.params['custid'];
	instid = request.params['instid'];
	fqid = mod_ca.caQualifiedId(custid, instid);

	if (fqid in agg_insts)
		return (agg_insts[fqid]);

	iarity = request.headers['x-ca-instn-arity'];
	igran = parseInt(request.headers['x-ca-instn-granularity'], 10);

	if (!iarity || !igran) {
		response.send(HTTP.ENOTFOUND);
		return (undefined);
	}

	/*
	 * If we found no corresponding instrumentation but we have enough
	 * information to fake one up, we do so.  This is provided so that we
	 * can service requests for instrumentations we don't yet know about
	 * (presumably because they're still being initialized) but can still
	 * report basic information about.
	 */
	agg_log.info('creating synthetic instn for %s', fqid);

	dataset = mod_caagg.caDatasetForInstrumentation({
	    'nsources': 0,
	    'granularity': igran,
	    'value-dimension': iarity == mod_ca.ca_arity_scalar ? 1 : 2,
	    'value-arity': iarity
	});

	instn = {
	    'agi_synthetic': true,
	    'agi_dataset': dataset,
	    'agi_instrumentation': {
		'granularity': igran,
		'transformations': [],
		'value-arity': iarity
	    }
	};

	return (instn);
}

/*
 * Services requests for admin/status.
 */
function aggHttpAdminStatus(request, response)
{
	response.send(HTTP.OK, aggAdminStatus());
}

/*
 * Services requests for the (static) resource .../value.
 */
function aggHttpValueList(request, response)
{
	var instn, url, rv;

	if (!(instn = aggHttpInstn(request, response)))
		return;

	url = request.url;
	rv = {};

	while (url[url.length - 1] === '/')
		url = url.substring(0, url.length - 1);

	rv = [ {
		name: 'value_raw',
		uri: url + '/raw'
	} ];

	if (mod_caagg.caAggrSupportsHeatmap(instn)) {
		rv.push({
			name: 'value_heatmap',
			uri: url + '/heatmap'
		});
	}

	response.send(HTTP.OK, rv);
}

/*
 * Services requests for the (static) resource .../value/heatmap.
 */
function aggHttpValueHeatmapList(request, response)
{
	var instn, rv, url;

	if (!(instn = aggHttpInstn(request, response)))
		return;

	if (!mod_caagg.caAggrSupportsHeatmap(instn)) {
		response.send(HTTP.ENOTFOUND);
		return;
	}

	url = request.url;

	while (url[url.length - 1] === '/')
		url = url.substring(0, url.length - 1);

	rv = [ {
		name: 'image',
		uri: url + '/image'
	}, {
		name: 'details',
		uri: url + '/details'
	}, {
		name: 'average',
		uri: url + '/average'
	}, {
		name: 'percentile',
		uri: url + '/percentile'
	} ];

	response.send(HTTP.OK, rv);
}

var aggValueParams = {
	duration: {
	    type: 'number',
	    min: 1,
	    max: 3600
	},
	end_time: {
	    type: 'number',
	    min: 0
	},
	ndatapoints: {
	    type: 'number',
	    min: 1,
	    default: 1
	},
	start_time: {
	    type: 'number',
	    min: 0
	},
	timeout: {
	    type: 'number',
	    min: 0,
	    max: 5000,
	    default: agg_http_req_timeout
	},
	transformations: {
	    type: 'array',
	    default: []
	}
};

/*
 * Services requests for instrumentation values.  The caAggrValueRequest class
 * handles the bulk of this work, delegating to "impl" to actually extract the
 * requested values.
 */
function aggHttpValueRetrieve(impl, request, response)
{
	var instn, aggrq;

	if ((instn = aggHttpInstn(request, response)) === undefined)
		return;

	/* XXX stick into global debug state */
	aggrq = new caAggrValueRequest(instn, impl, request, response);
	aggrq.start();
}

/*
 * Applies the specified transformations on the given "keys".  Returns an object
 * where each key corresponds to a requested transformation, and the
 * corresponding value maps elements of "keys" to the transformed value.
 */
function aggHttpValueTransform(xforms, keys)
{
	var ret, xform, ii;

	ret = {};

	/*
	 * If for some reason one of our transformation backends blow up, we
	 * shouldn't abort everything because of that. We should log what
	 * happened and set their return value to be the empty object. It's
	 * important that the user still be able to get the data they requested.
	 */
	for (ii = 0; ii < xforms.length; ii++) {
		xform = xforms[ii];

		try {
			ret[xform] = agg_transforms[xform].transform(keys);
		} catch (ex) {
			ret[xform] = {};
			agg_log.error('ERROR from transform %s: %r', xform, ex);
		}
	}

	return (ret);
}

/*
 * Represents an HTTP request to retrieve one or more data points and
 * encapsulates the process of servicing the request.  "instn" represents the
 * aggregator's representation of the instrumentation, and "impl" represents the
 * backend implementation that handles this type of value request.
 */
function caAggrValueRequest(instn, impl, request, response)
{
	this.avr_instn = instn;
	this.avr_gran = instn.agi_instrumentation['granularity'];
	this.avr_rqtime = new Date().getTime();
	this.avr_impl = impl;
	this.avr_request = request;
	this.avr_response = response;
}

/*
 * Processes the request.
 */
caAggrValueRequest.prototype.start = function ()
{
	var response, dataset;

	response = this.avr_response;
	dataset = this.avr_instn.agi_dataset;

	ASSERT.ok(this.avr_input === undefined,
	    'this object cannot be used to process multiple requests');

	if (!this.avr_impl.ai_check(this))
		return (response.send(HTTP.ENOTFOUND));

	try {
		this.loadParameters();
	} catch (ex) {
		if (!(ex instanceof caValidationError))
			throw (ex);

		return (response.sendError(ex));
	}

	if (this.avr_latest_end === undefined)
		return (response.send(HTTP.OK, []));

	if (this.avr_latest_end * 1000 > this.avr_rqtime + this.avr_timeout)
		return (response.sendError(new caValidationError(
		    'requested data point is too far in the future')));

	if (dataset.nreporting(this.avr_latest_end - this.avr_gran) >=
	    aggExpected(dataset, this.avr_latest_end - this.avr_gran))
		return (this.complete());

	/*
	 * Only synthetic instrumentations have no "agi_requests" field, but
	 * aggExpected() for such instns should have been zero.
	 */
	ASSERT.ok(this.avr_instn.agi_requests);
	this.avr_instn.agi_requests.push(this);
	return (undefined);
};

/*
 * Used internally to load instance state from the request parameters.
 */
caAggrValueRequest.prototype.loadParameters = function ()
{
	var params, param, oival, nival, npoints, point, default_duration;
	var end, ii;

	/*
	 * Extract and validate parameters.
	 */
	params = this.avr_request.ca_json || this.avr_request.ca_params;
	param = mod_ca.caHttpParam.bind(null, aggValueParams, params);

	this.avr_timeout = param('timeout');
	this.avr_xforms = param('transformations');
	this.avr_input = {
	    start_time: param('start_time'),
	    duration: param('duration'),
	    end_time: param('end_time'),
	    ndatapoints: param('ndatapoints')
	};

	this.avr_usearray = 'ndatapoints' in params;
	this.validate();

	/*
	 * Compute the list of individual data points specified in this request.
	 * While it's suboptimal to build this list in-memory, we have to keep
	 * the result list in-memory anyway (at least until we have a streaming
	 * version of JSON.stringify()).
	 */
	default_duration = this.avr_impl.ai_duration;
	this.avr_points = [];

	oival = mod_caagg.caAggrInterval(this.avr_input,
	    this.avr_rqtime, default_duration, this.avr_gran);

	nival = this.avr_instn.agi_dataset.normalizeInterval(
	    oival['start_time'], oival['duration']);

	npoints = this.avr_input['ndatapoints'];

	for (ii = 0; ii < npoints; ii++) {
		point = {
		    start_time: nival['start_time'] + ii * nival['duration'],
		    duration: nival['duration'],
		    requested_start_time: oival['start_time'] +
			ii * oival['duration'],
		    requested_duration: oival['duration'],
		    requested_end_time: oival['start_time'] +
			(ii + 1) * oival['duration']
		};

		this.avr_points.push(point);

		end = point['start_time'] + point['duration'];
		if (this.avr_latest_end === undefined ||
		    end > this.avr_latest_end)
			this.avr_latest_end = end;
	}
};

/*
 * Used internally to validate parameters.
 */
caAggrValueRequest.prototype.validate = function ()
{
	var valid_xforms, xform, ii;

	valid_xforms = this.avr_instn.agi_instrumentation['transformations'];

	for (ii = 0; ii < this.avr_xforms.length; ii++) {
		xform = this.avr_xforms[ii];

		if (!(xform in agg_transforms))
			throw (new caInvalidFieldError('transformations',
			    this.avr_xforms, 'transformation "%s" does not ' +
			    'exist', xform));

		if (!(xform in valid_xforms))
			throw (new caInvalidFieldError('transformations',
			    this.avr_xforms, 'transformation "%s" is not ' +
			    'allowed on this instrumentation', xform));
	}
};

/*
 * Complete the request.  This function is invoked when we either have
 * sufficient data to satisfy the request or we've timed out waiting for that
 * data.
 */
caAggrValueRequest.prototype.complete = function (delaynow)
{
	var response, xform, dataset, ret, val, point, ii;

	response = this.avr_response;
	dataset = this.avr_instn.agi_dataset;
	xform = aggHttpValueTransform.bind(null, this.avr_xforms);
	ret = [];

	for (ii = 0; ii < this.avr_points.length; ii++) {
		point = this.avr_points[ii];

		try {
			val = this.avr_impl.ai_value(dataset,
			    point['start_time'], point['duration'], xform,
			    this.avr_request);
		} catch (ex) {
			agg_log.error('failed to process value request: %r',
			    ex);
			response.sendError(new caError(
			    ex instanceof caError ? ex.code() : ECA_UNKNOWN, ex,
			    'failed to process data point "%s" (%j)', ii + 1,
			    point));
			return;
		}

		if (delaynow)
			val['delay'] = delaynow - this.avr_rqtime;
		val['start_time'] = point['start_time'];
		val['duration'] = point['duration'];
		val['end_time'] = point['start_time'] + point['duration'];
		val['nsources'] = dataset.nsources();
		val['minreporting'] = dataset.nreporting(
		    point['start_time'], point['duration']);
		val['requested_start_time'] = point['requested_start_time'];
		val['requested_duration'] = point['requested_duration'];
		val['requested_end_time'] = point['requested_end_time'];
		ret.push(val);
	}

	if (this.avr_usearray)
		return (response.send(HTTP.OK, ret));

	ASSERT.equal(ret.length, 1);
	return (response.send(HTTP.OK, ret[0]));
};

caAggrValueRequest.prototype.instn = function ()
{
	return (this.avr_instn);
};

caAggrValueRequest.prototype.latest = function ()
{
	return (this.avr_latest_end - this.avr_gran);
};

caAggrValueRequest.prototype.rqtime = function ()
{
	return (this.avr_rqtime);
};

caAggrValueRequest.prototype.timeout = function ()
{
	return (this.avr_timeout);
};

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

main();
