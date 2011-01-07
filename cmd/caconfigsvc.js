/*
 * caconfigsvc: Cloud Analytics Configuration Service
 *
 * This service is responsible for directing other components of the cloud
 * analytics service, including instrumenters and aggregators.
 */

var mod_sys = require('sys');
var ASSERT = require('assert');

var mod_ca = require('../lib/ca/ca-common');
var mod_caamqp = require('../lib/ca/ca-amqp');
var mod_cap = require('../lib/ca/ca-amqp-cap');
var mod_cahttp = require('../lib/ca/ca-http');
var mod_log = require('../lib/ca/ca-log');
var mod_mapi = require('../lib/ca/ca-mapi');
var HTTP = require('../lib/ca/http-constants');

var cfg_http;			/* http server */
var cfg_cap;			/* camqp CAP wrapper */
var cfg_log;			/* log handle */
var cfg_mapi;			/* mapi handle */

var cfg_name = 'configsvc';	/* component name */
var cfg_vers = '0.0';		/* component version */
var cfg_http_port = 23181;	/* HTTP port for API endpoint */
var cfg_http_baseuri = '/ca';

var cfg_aggregators = {};	/* all aggregators, by hostname */
var cfg_instrumenters = {};	/* all instrumenters, by hostname */
var cfg_statmods = {};		/* describes available metrics and which */
				/* instrumenters provide them. */

var cfg_retain_min = 10;		/* max data retention time: 10 sec */
var cfg_retain_max = 10 * 60 * 60;	/* max data retention time: 1 hour */
var cfg_retain_default = 10 * 60;	/* default data retention: 10 min */

/*
 * The following constants and data structures manage active instrumentations.
 * Each instrumentation is either global or associated with a particular
 * customer.  For internal use, each instrumentation has a qualified identifier
 * with one of the following forms:
 *
 *	global;<instid>			For global instrumentations
 *	cust:<custid>;<instid>		For per-customer instrumentations
 *
 * In both of these forms, <instid> is a positive integer.  These qualified
 * identifiers are only used by this implementation; they are not exposed
 * through any public interface.
 *
 * All instrumentation objects are stored in cfg_insts indexed by this fully
 * qualified identifier.  Additionally, the set of per-customer instrumentations
 * is stored in cfg_customers[customer_id]['instrumentations'], and the set of
 * global instrumentations is stored in cfg_global_insts.
 */
var cfg_inst_id = 1;		/* next available global id */
var cfg_insts = {};		/* all instrumentations, by inst id */
var cfg_customers = {};		/* all customers, by cust id */
var cfg_global_insts = {};	/* global (non-customer) insts */

function main()
{
	var http_port = cfg_http_port;
	var broker = mod_ca.caBroker();
	var mapi = mod_ca.caMapiConfig();
	var sysinfo = mod_ca.caSysinfo(cfg_name, cfg_vers);
	var hostname = sysinfo.ca_hostname;
	var amqp;

	cfg_log = new mod_log.caLog({ out: process.stdout });

	amqp = new mod_caamqp.caAmqp({
	    broker: broker,
	    exchange: mod_ca.ca_amqp_exchange,
	    exchange_opts: mod_ca.ca_amqp_exchange_opts,
	    basename: mod_ca.ca_amqp_key_base_config,
	    hostname: hostname,
	    bindings: [ mod_ca.ca_amqp_key_config, 'ca.broadcast' ]
	});
	amqp.on('amqp-error', mod_caamqp.caAmqpLogError(cfg_log));
	amqp.on('amqp-fatal', mod_caamqp.caAmqpFatalError(cfg_log));

	cfg_cap = new mod_cap.capAmqpCap({
	    amqp: amqp,
	    log: cfg_log,
	    sysinfo: sysinfo
	});
	cfg_cap.on('msg-cmd-ping', cfgCmdPing);
	cfg_cap.on('msg-cmd-status', cfgCmdStatus);
	cfg_cap.on('msg-notify-aggregator_online', cfgNotifyAggregatorOnline);
	cfg_cap.on('msg-notify-configsvc_online', mod_ca.caNoop);
	cfg_cap.on('msg-notify-instrumenter_online',
	    cfgNotifyInstrumenterOnline);
	cfg_cap.on('msg-notify-log', cfgNotifyLog);
	cfg_cap.on('msg-notify-instrumenter_error', cfgNotifyInstrumenterError);
	cfg_cap.on('msg-ack-enable_instrumentation', cfgAckEnable);
	cfg_cap.on('msg-ack-disable_instrumentation', cfgAckDisable);
	cfg_cap.on('msg-ack-enable_aggregation', cfgAckEnableAgg);

	cfg_http = new mod_cahttp.caHttpServer({
	    log: cfg_log,
	    port: http_port,
	    router: cfgHttpRouter
	});

	cfg_log.info('Config service starting up (%s/%s)', cfg_name, cfg_vers);
	cfg_log.info('%-12s %s', 'Hostname:', hostname);
	cfg_log.info('%-12s %s', 'AMQP broker:', JSON.stringify(broker));
	cfg_log.info('%-12s %s', 'Routing key:', amqp.routekey());
	cfg_log.info('%-12s Port %d', 'HTTP server:', http_port);

	if (mapi) {
		cfg_log.info('%-12s %s:%s', 'MAPI host:', mapi.host, mapi.port);
		cfg_mapi = new mod_mapi.caMapi(mapi);
	} else {
		cfg_log.warn('MAPI_HOST, MAPI_PORT, MAPI_USER, or ' +
		    'MAPI_PASSWORD not set.  Per-customer use disabled.');
	}

	amqp.start(function () {
		cfg_log.info('AMQP broker connected.');

		cfg_http.start(function () {
			cfg_log.info('HTTP server started.');
			cfgStarted();
		});
	});
}

function cfgStarted()
{
	cfg_cap.sendNotifyCfgOnline(mod_ca.ca_amqp_key_all);
}

/*
 * Defines the available HTTP URIs.  See the Public HTTP API doc for details.
 */
function cfgHttpRouter(server)
{
	var metrics = '/metrics';
	var instrumentations = '/instrumentations';
	var instrumentations_id = instrumentations + '/:instid';
	var infixes = [ '', '/customers/:custid' ];
	var ii, base;

	for (ii = 0; ii < infixes.length; ii++) {
		base = cfg_http_baseuri + infixes[ii];
		server.get(base + metrics, cfgHttpMetricsList);
		server.get(base + instrumentations,
		    cfgHttpInstrumentationsList);
		server.post(base + instrumentations, cfgHttpInstCreate);
		server.del(base + instrumentations_id, cfgHttpInstDelete);
		server.get(base + instrumentations_id, cfgHttpInstGetOptions);
		server.put(base + instrumentations_id, cfgHttpInstSetOptions);
	}
}

/*
 * Given a customer identifier, return the set of instrumentations.  If custid
 * is undefined, returns the set of global instrumentations.  This function
 * always returns a valid object even if we've never seen this customer
 * before.
 */
function cfgInstrumentations(custid)
{
	if (custid === undefined)
		return (cfg_global_insts);

	if (!(custid in cfg_customers))
		return ({});

	return (cfg_customers[custid].instrumentations);
}

function cfgHttpMetricsList(request, response)
{
	response.send(HTTP.OK, cfg_statmods);
}

function cfgHttpInstrumentationsList(request, response)
{
	var custid = request.params['custid'];
	var rv = [];

	cfgInstrumentationsListCustomer(
	    rv, cfgInstrumentations(custid), custid);

	if (custid === undefined) {
		for (custid in cfg_customers)
			cfgInstrumentationsListCustomer(rv,
			    cfgInstrumentations(custid), custid);
	}

	response.send(HTTP.OK, rv);
}

function cfgInstrumentationsListCustomer(rv, insts, custid)
{
	var instid, inst;

	for (instid in insts) {
		inst = mod_ca.caDeepCopy(cfg_insts[instid]['spec']);
		inst['inst_id'] = instid.substring(instid.lastIndexOf(';') + 1);

		if (custid !== undefined)
			inst['customer_id'] = custid;

		rv.push(inst);
	}
}

function cfgHttpInstCreate(request, response)
{
	var custid = request.params['custid'];
	var params, spec, instid, aggregator;

	/*
	 * If the user specified a JSON object, we use that.  Otherwise, we
	 * assume they specified parameters in form fields.
	 */
	params = request.ca_json || request.ca_params;

	cfg_log.dbg('request to instrument:\n%j', params);

	try {
		spec = cfgValidateMetric(params);
	} catch (ex) {
		response.send(HTTP.EBADREQUEST,
		    'failed to validate instrumentation: ' + ex.message);
		return;
	}

	aggregator = cfgPickAggregator();

	if (!aggregator) {
		response.send(HTTP.ESERVER, 'no aggregators available');
		return;
	}

	if (custid === undefined) {
		instid = cfg_inst_id++;  /* XXX should be unique across time. */
		cfgHttpInstCreateFinish(response, custid, instid, spec,
		    aggregator, null);
		return;
	}

	if (!cfg_mapi) {
		response.send(HTTP.ESERVER, 'mapi not in use');
		return;
	}

	cfg_mapi.listContainers(custid, function (err, zonesbyhost) {
		if (err) {
			cfg_log.warn('failed to list customer zones for %s: %s',
			    custid, err.toString());
			response.send(HTTP.ESERVER, 'failed to list ' +
			    'customer zones');
			return;
		}

		if (!(custid in cfg_customers)) {
			cfg_customers[custid] = {
				next_id: 1,
				instrumentations: {}
			};
		}

		instid = cfg_customers[custid].next_id++;

		cfgHttpInstCreateFinish(response, custid, instid, spec,
		    aggregator, zonesbyhost);
	});
}

function cfgHttpInstCreateFinish(response, custid, instid, spec, aggregator,
    zonesbyhost)
{
	var fqid, instrumenter, hosts, hostname;

	fqid = mod_ca.caQualifiedId(custid, instid);
	cfgInstrumentations(custid)[fqid] = true;
	aggregator.cag_insts[fqid] = true;
	aggregator.cag_ninsts++;

	cfg_insts[fqid] = {
		options: {
		    enabled: true,
		    'retention-time': cfg_retain_default
		},
		agg_result: undefined,
		insts_failed: 0,
		insts_ok: 0,
		insts_total: 0,
		response: response,
		spec: spec,
		aggregator: aggregator
	};

	if (zonesbyhost)
		cfg_insts[fqid]['zonesbyhost'] = zonesbyhost;

	cfgAggEnable(aggregator, fqid);

	/*
	 * XXX wait for agg to complete
	 */
	hosts = zonesbyhost ? zonesbyhost : cfg_instrumenters;
	for (hostname in hosts) {
		cfg_insts[fqid].insts_total++;
		instrumenter = cfg_instrumenters[hostname];
		instrumenter.ins_insts[fqid] = true;
		instrumenter.ins_ninsts++;
		cfgInstEnable(instrumenter, fqid);
	}

	/* XXX timeout HTTP request */
}

/*
 * Pick an aggregator for collecting data for this instrumentation.  This
 * algorithm could be smarter.  We currently just compare the number of stats an
 * aggregator is already aggregating.  We should also try other ones if the one
 * we pick seems down.
 */
function cfgPickAggregator()
{
	var key, mincount, minkey;

	for (key in cfg_aggregators) {
		if (mincount === undefined ||
		    cfg_aggregators[key].cag_ninsts < mincount) {
			mincount = cfg_aggregators[key].cag_ninsts;
			minkey = key;
		}
	}

	if (mincount === undefined)
		return (undefined);

	return (cfg_aggregators[minkey]);
}

/*
 * Validate the metric and retrieve its type.  We send the type information to
 * both the client and the aggregator so they know what kind of data to expect.
 */
function cfgValidateMetric(params)
{
	var decomp;
	var spec = {};
	var check = function (obj, field, required) {
		if (required && !obj[field])
			throw (new Error('missing required field: ' + field));

		return (obj[field] || '');
	};

	spec.modname = check(params, 'module', true);
	spec.statname = check(params, 'stat', true);
	decomp = check(params, 'decomposition', false);

	if (typeof (decomp) == typeof (''))
		decomp = decomp.length > 0 ? decomp.split(',') : [];

	spec.decomp = decomp;
	spec.stattype = cfgStatType(spec.modname, spec.statname, spec.decomp);
	return (spec);
}

function cfgHttpInstDelete(request, response)
{
	var custid = request.params['custid'];
	var instid = request.params['instid'];
	var fqid = mod_ca.caQualifiedId(custid, instid);
	var instrumenter, aggregator, hostid;

	if (!(fqid in cfg_insts)) {
		response.send(HTTP.ENOTFOUND, HTTP.MSG_NOTFOUND);
		return;
	}

	aggregator = cfg_insts[fqid].aggregator;
	aggregator.cag_ninsts--;
	delete (aggregator.cag_insts[fqid]);

	for (hostid in cfg_instrumenters) {
		instrumenter = cfg_instrumenters[hostid];

		if (!(fqid in instrumenter.ins_insts))
			continue;

		instrumenter.ins_ninsts--;
		delete (instrumenter.ins_insts[fqid]);
		cfg_cap.sendCmdDisableInst(instrumenter.ins_routekey, fqid,
			fqid);
	}

	delete (cfgInstrumentations(custid)[fqid]);
	delete (cfg_insts[fqid]);
	response.send(HTTP.OK);
}

function cfgHttpInstSetOptions(request, response)
{
	var custid = request.params['custid'];
	var instid = request.params['instid'];
	var fqid = mod_ca.caQualifiedId(custid, instid);
	var inst, retain, options;

	if (!(fqid in cfg_insts)) {
		response.send(HTTP.ENOTFOUND, HTTP.MSG_NOTFOUND);
		return;
	}

	inst = cfg_insts[fqid];

	if (request.ca_json === undefined) {
		response.send(HTTP.EBADREQUEST, 'no JSON specified');
		return;
	}

	/* Validate and apply options, if we supported any. */
	options = request.ca_json;
	if (options.constructor !== Object) {
		response.send(HTTP.EBADREQUEST, 'invalid options');
		return;
	}

	if ('enabled' in options && options['enabled'] !== true) {
		response.send(HTTP.EBADREQUEST,
		    'unsupported value for "enabled"');
		return;
	}

	if ('retention-time' in options) {
		retain = parseInt(options['retention-time'], 10);
		if (isNaN(retain))
			response.send(HTTP.EBADREQUEST,
			    'unsupported value for "retention-time"');
		retain = Math.max(retain, cfg_retain_min);
		retain = Math.min(retain, cfg_retain_max);
	}

	if (retain != inst.options['retention-time']) {
		inst.options['retention-time'] = retain;
		cfgAggEnable(inst.aggregator, fqid);
		/* XXX wait for response? */
	}

	cfgHttpInstGetOptions(request, response);
}

function cfgHttpInstGetOptions(request, response)
{
	var custid = request.params['custid'];
	var instid = request.params['instid'];
	var fqid = mod_ca.caQualifiedId(custid, instid);

	if (!(fqid in cfg_insts)) {
		response.send(HTTP.ENOTFOUND, HTTP.MSG_NOTFOUND);
		return;
	}

	response.send(HTTP.OK, cfg_insts[fqid]['options']);
}

function cfgAggEnable(aggregator, id)
{
	var statkey = mod_ca.caKeyForInst(id);
	var stattype = cfg_insts[id]['spec']['stattype'];
	cfg_cap.sendCmdEnableAgg(aggregator.cag_routekey, id, id, statkey,
	    stattype['dimension'], cfg_insts[id]['options']);
}

function cfgInstEnable(instrumenter, id)
{
	var hostname, statkey, inst, spec;
	var zonesbyhost, zones;

	hostname = instrumenter.ins_hostname;
	statkey = mod_ca.caKeyForInst(id);

	inst = cfg_insts[id];
	spec = inst['spec'];
	zonesbyhost = inst['zonesbyhost'];

	if (zonesbyhost) {
		ASSERT.ok(hostname in zonesbyhost);
		zones = zonesbyhost[hostname];
	}

	cfg_cap.sendCmdEnableInst(instrumenter.ins_routekey, id, id, statkey,
	    spec, zones);
}

function cfgCheckNewInstrumentation(id)
{
	var inst = cfg_insts[id];
	var instid = id.substring(id.lastIndexOf(';') + 1);
	var response, stattype, dim, type;

	if (!('response' in inst))
		return;

	if (inst.agg_done === undefined ||
	    inst.insts_failed + inst.insts_ok < inst.insts_total)
		return;

	/*
	 * We may get here multiple times if an aggregator restarts, but we
	 * don't want to try to answer the original response again after the
	 * first time.
	 */
	response = inst.response;
	delete (inst['response']);

	if (inst.agg_done === false) {
		/* XXX could try another aggregator. */
		response.send(HTTP.ESERVER,
		    'error: failed to enable aggregator');
		return;
	}

	if (inst.insts_failed > 0) {
		response.send(HTTP.ESERVER,
		    'error: failed to enable some instrumenters');
		return;
	}

	stattype = inst.spec.stattype;
	dim = stattype['dimension'];
 	type = dim == 1 ? 'scalar' : stattype['type'];
	response.send(HTTP.CREATED, { id: instid, dimension: dim, type: type });
}

function cfgAckEnableAgg(msg)
{
	var id;

	if (!('ag_inst_id' in msg)) {
		cfg_log.warn('dropped ack-enable_aggregation message with ' +
		    'missing id');
		return;
	}

	id = msg.ag_inst_id;

	if (msg.ag_status != 'enabled') {
		/* XXX in restart case this should do something. */
		cfg_insts[id].agg_done = false;
	} else {
		cfg_insts[id].agg_done = true;
	}

	cfgCheckNewInstrumentation(id);
}

function cfgAckEnable(msg)
{
	var id, result;

	if (!('is_inst_id' in msg)) {
		cfg_log.warn('dropped ack-enable_instrumentation message ' +
		    'with missing id');
		return;
	}

	id = msg.is_inst_id;
	result = msg.is_status;
	if (msg.is_status != 'enabled') {
		cfg_insts[id].insts_failed++;
		result += ' (' + msg.is_error + ')';
	} else {
		cfg_insts[id].insts_ok++;
	}

	cfg_log.info('host %s instrument %s: %s', msg.ca_hostname,
	    msg.is_inst_id, result);
	cfgCheckNewInstrumentation(id);
}

function cfgAckDisable(msg)
{
	var result;

	result = msg.is_status;
	if (msg.is_status != 'disabled')
		result += ' (' + msg.is_error + ')';

	cfg_log.info('host %s deinstrument %s: %s', msg.ca_hostname,
	    msg.is_inst_id, result);
}

function cfgCmdPing(msg)
{
	cfg_cap.sendCmdAckPing(msg.ca_source, msg.ca_id);
}

function cfgCmdStatus(msg)
{
	var key, inst, agg;
	var sendmsg = {};

	sendmsg.s_component = 'config';

	sendmsg.s_instrumenters = [];
	for (key in cfg_instrumenters) {
		inst = cfg_instrumenters[key];
		sendmsg.s_instrumenters.push({
		    sii_hostname: inst.ins_hostname,
		    sii_nmetrics_avail: inst.ins_nmetrics_avail,
		    sii_ninsts: inst.ins_ninsts
		});
	}

	sendmsg.s_aggregators = [];
	for (key in cfg_aggregators) {
		agg = cfg_aggregators[key];
		sendmsg.s_aggregators.push({
		    sia_hostname: agg.cag_hostname,
		    sia_ninsts: agg.cag_ninsts
		});
	}

	cfg_cap.sendCmdAckStatus(msg.ca_source, msg.ca_id, sendmsg);
}

function cfgNotifyAggregatorOnline(msg)
{
	var id, agg, action;

	if (msg.ca_hostname in cfg_aggregators) {
		agg = cfg_aggregators[msg.ca_hostname];
		action = 'restarted';
	} else {
		agg = cfg_aggregators[msg.ca_hostname] = {};
		action = 'started';
		agg.cag_ninsts = 0;
		agg.cag_insts = {};
	}

	agg.cag_hostname = msg.ca_hostname;
	agg.cag_routekey = msg.ca_source;
	agg.cag_agent_name = msg.ca_agent_name;
	agg.cag_agent_version = msg.ca_agent_version;
	agg.cag_os_name = msg.ca_os_name;
	agg.cag_os_release = msg.ca_os_release;
	agg.cag_os_revision = msg.ca_os_revision;

	for (id in agg.cag_insts)
		cfgAggEnable(agg, id);

	cfg_log.info('aggregator %s: %s', action, msg.ca_hostname);
}

function cfgNotifyInstrumenterOnline(msg)
{
	var inst, action;
	var mod, mstats, stat, mfields, field;
	var mm, ss, ff, id;

	if (msg.ca_hostname in cfg_instrumenters) {
		inst = cfg_instrumenters[msg.ca_hostname];
		action = 'restarted';
	} else {
		inst = cfg_instrumenters[msg.ca_hostname] = {};
		action = 'started';
		inst.ins_insts = {};
		inst.ins_ninsts = 0;
	}

	inst.ins_hostname = msg.ca_hostname;
	inst.ins_routekey = msg.ca_source;
	inst.ins_agent_name = msg.ca_agent_name;
	inst.ins_agent_version = msg.ca_agent_version;
	inst.ins_os_name = msg.ca_os_name;
	inst.ins_os_release = msg.ca_os_release;
	inst.ins_os_revision = msg.ca_os_revision;
	inst.ins_nmetrics_avail = 0;

	for (mm = 0; mm < msg.ca_modules.length; mm++) {
		mod = msg.ca_modules[mm];

		if (!(mod.cam_name in cfg_statmods)) {
			cfg_statmods[mod.cam_name] = {
				stats: {},
				label: mod.cam_description
			};
		}

		mstats = cfg_statmods[mod.cam_name]['stats'];
		inst.ins_nmetrics_avail += mod.cam_stats.length;

		for (ss = 0; ss < mod.cam_stats.length; ss++) {
			stat = mod.cam_stats[ss];
			if (!(stat.cas_name in mstats)) {
				mstats[stat.cas_name] = {
				    label: stat.cas_description,
				    type: stat.cas_type,
				    fields: {}
				};
			}

			mfields = mstats[stat.cas_name]['fields'];

			for (ff = 0; ff < stat.cas_fields.length; ff++) {
				field = stat.cas_fields[ff];

				if (!(field.caf_name in mfields)) {
					mfields[field.caf_name] = {
					    type: field.caf_type,
					    label: field.caf_description
					};
				}
			}
		}
	}

	for (id in inst.ins_insts)
		cfgInstEnable(inst, id);

	cfg_log.info('instrumenter %s: %s', action, msg.ca_hostname);
}

function cfgNotifyLog(msg)
{
	if (!('l_message' in msg)) {
		cfg_log.warn('dropped log message with missing message');
		return;
	}

	cfg_log.warn('from %s: %s %s', msg.ca_hostname, msg.ca_time,
	    msg.l_message);
}

function cfgNotifyInstrumenterError(msg)
{
	if (!('ins_inst_id' in msg) || !('ins_error' in msg) ||
	    !('ins_status' in msg) ||
	    (msg['status'] != 'enabled' && msg['status'] != 'disabled')) {
		cfg_log.warn('dropping malformed inst error message');
		return;
	}

	if (!(msg.ca_hostname in cfg_instrumenters)) {
		cfg_log.warn('dropping inst error message for unknown host ' +
		    '"%s"', msg.ca_hostname);
		return;
	}

	/* XXX */
}

/*
 * Given an instrumentation specification (with 'module', 'stat', 'predicate',
 * and 'decomposition' fields), validate the stat and return the type of one of
 * the resulting data points.  This is specified as an object with the following
 * member:
 *
 *	dimension	Describes the dimensionality of each datum as an
 *			integer.  For simple scalar metrics, the dimension is 1.
 *			The dimensionality increases with each decomposition.
 *
 *	type		Describes the datum itself.  If dimension is 1, then
 *			type is always 'scalar'.  If any decompositions use a
 *			linear field (e.g., latency), then type is
 *			'linear-decomposition'.  Otherwise, type is
 *			'discrete-decomposition'.
 *
 * Combined, this information allows clients to know whether to visualize the
 * result as a simple line graph, a line graph with multiple series, or a
 * heatmap.  For examples:
 *
 *	METRIC				DIM	type		VISUAL
 *	i/o ops				1	scalar		line
 *	i/o ops by disk			2	discrete 	multi-line
 *	i/o ops by latency		2	linear		heatmap
 *	i/o ops by latency and disk	3	linear		heatmap
 *
 * If the given instrumentation does not specify a valid stat, this function
 * throws an exception whose message describes why.
 */
function cfgStatType(modname, statname, decomp)
{
	var sprintf = mod_ca.caSprintf;
	var mod, stat, fields, field, type, ii;

	if (!(modname in cfg_statmods))
		throw (new Error('module does not exist: ' + modname));

	mod = cfg_statmods[modname];

	if (!(statname in mod['stats']))
		throw (new Error(sprintf('stat does not exist in ' +
		    'module "%s": %s', modname, statname)));

	stat = mod['stats'][statname];
	fields = stat['fields'];

	type = decomp.length === 0 ? 'scalar' : 'discrete-decomposition';

	for (ii = 0; ii < decomp.length; ii++) {
		field = decomp[ii];

		if (!(field in fields))
			throw (new Error(sprintf('field does not exist in ' +
			    'module %s, stat %s: %s', modname, statname,
			    field)));

		if (fields[field].type == 'scalar')
			type = 'linear-decomposition';
	}

	/* XXX validate predicate */

	return ({ dimension: decomp.length + 1, type: type });
}

main();
