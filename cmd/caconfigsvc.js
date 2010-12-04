/*
 * caconfigsvc: Cloud Analytics Configuration Service
 *
 * This service is responsible for directing other components of the cloud
 * analytics service, including instrumenters and aggregators.
 */

var mod_ca = require('ca');
var mod_caamqp = require('ca-amqp');
var mod_cap = require('ca-amqp-cap');
var mod_cahttp = require('ca-http');
var mod_log = require('ca-log');
var HTTP = require('http-constants');

var cfg_name = 'configsvc';	/* component name */
var cfg_vers = '0.0';		/* component version */
var cfg_http_port = 23181;	/* HTTP port for API endpoint */
var cfg_http_baseurl = '/metrics';
var cfg_http_insturl = cfg_http_baseurl + '/instrumentation';
var cfg_http_instidurl = cfg_http_insturl + '/:id';

var cfg_aggregators = {};	/* all aggregators, by hostname */
var cfg_instrumenters = {};	/* all instrumenters, by hostname */
var cfg_statmods = {};		/* describes available metrics and which */
				/* instrumenters provide them. */

var cfg_http;			/* http server */
var cfg_cap;			/* camqp CAP wrapper */
var cfg_log;			/* log handle */

function main()
{
	var http_port = cfg_http_port;
	var broker = mod_ca.ca_amqp_default_broker;
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
		bindings: [ mod_ca.ca_amqp_key_config ]
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

	amqp.start(function () {
		cfg_log.info('AMQP broker connected.');
	});

	cfg_http.start(function () {
		cfg_log.info('HTTP server started.');
	});
}

var cfg_inst_id = 1;
var cfg_insts = {};

function cfgHttpRouter(server)
{
	server.get(cfg_http_baseurl, cfgHttpListMetrics);
	server.post(cfg_http_insturl, cfgHttpCreate);
	server.del(cfg_http_instidurl, cfgHttpDelete);
}

function cfgHttpCreate(request, response)
{
	var id, key;
	var modname, statname, decomp;
	var mincount, minkey;
	var statkey, ninsts;
	var stattype;
	var params;
	var aggregator;

	/*
	 * If the user specified a JSON object, we use that.  Otherwise, we
	 * assume they specified parameters in form fields.
	 */
	params = request.ca_json || request.ca_params;

	/*
	 * Validate the metric and retrieve its type.  We'll send the type
	 * information to both the client and the aggregator so they know what
	 * kind of data to expect.
	 */
	var check = function (obj, field, required) {
		if (required && !obj[field])
			throw (new Error('missing required field: ' + field));

		return (obj[field] || '');
	};

	try {
		modname = check(params, 'module', true);
		statname = check(params, 'stat', true);
		decomp = check(params, 'decomposition', false);
		decomp = decomp.length > 0 ? decomp.split(',') : [];

		stattype = cfgStatType(modname, statname, decomp);
	} catch (ex) {
		response.send(HTTP.EBADREQUEST,
		    'failed to validate instrumentation: ' + ex.message);
		return;
	}

	/*
	 * Pick an aggregator and have it collect data for this instrumentation.
	 * This algorithm could be smarter.  We currently just compare the
	 * number of stats an aggregator is already aggregating.  We should also
	 * try other ones if the one we pick seems down.
	 */
	for (key in cfg_aggregators) {
		if (mincount === undefined ||
		    cfg_aggregators[key].cag_ninsts < mincount) {
			mincount = cfg_aggregators[key].cag_ninsts;
			minkey = key;
		}
	}

	if (mincount === undefined) {
		response.send(HTTP.ESERVER, 'no aggregators available');
		return;
	}

	aggregator = cfg_aggregators[minkey];
	aggregator.cag_ninsts++;
	id = cfg_inst_id++;  /* XXX should be unique across time. */
	statkey = mod_ca.caKeyForInst(id);

	cfg_cap.send(aggregator.cag_routekey, {
	    ca_id: id,
	    ca_type: 'cmd',
	    ca_subtype: 'enable_aggregation',
	    ag_inst_id: id,
	    ag_key: statkey,
	    ag_dimension: stattype['dimension']
	});

	/*
	 * XXX filter these based on 'nodes'
	 */
	ninsts = 0;
	for (key in cfg_instrumenters) {
		ninsts++;
		cfg_cap.send(cfg_instrumenters[key].ins_routekey, {
		    ca_id: id,
		    ca_type: 'cmd',
		    ca_subtype: 'enable_instrumentation',
		    is_inst_key: statkey,
		    is_inst_id: id,
		    is_module: modname,
		    is_stat: statname,
		    is_predicate: [],
		    is_decomposition: decomp
		});
		cfg_instrumenters[key].ins_ninsts++;
	}

	cfg_insts[id] = {
	    agg_result: undefined,
	    insts_failed: 0,
	    insts_ok: 0,
	    insts_total: ninsts,
	    response: response,
	    stattype: stattype
	};

	/* XXX timeout HTTP request */
}

function cfgHttpDelete(request, response)
{
	var id = request.params['id'];
	var key;

	if (!(id in cfg_insts)) {
		response.send(HTTP.ENOTFOUND, HTTP.MSG_NOTFOUND);
		return;
	}

	delete (cfg_insts[id]);
	response.send(HTTP.OK);

	/*
	 * XXX filter these based on 'nodes'
	 * XXX decrement aggregator.agg_ninsts
	 */
	for (key in cfg_instrumenters) {
		cfg_instrumenters[key].ins_ninsts--;
		cfg_cap.send(cfg_instrumenters[key].ins_routekey, {
		    ca_type: 'cmd',
		    ca_subtype: 'disable_instrumentation',
		    ca_id: id,
		    is_inst_id: id
		});
	}
}

function cfgHttpListMetrics(request, response)
{
	response.send(HTTP.OK, cfg_statmods);
}

function cfgCheckNewInstrumentation(id)
{
	var inst = cfg_insts[id];
	var response = inst.response;
	var stattype, dim, type;

	if (inst.agg_done === undefined ||
	    inst.insts_failed + inst.insts_ok < inst.insts_total)
		return;

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

	stattype = inst.stattype;
	dim = stattype['dimension'];
 	type = dim == 1 ? 'scalar' : stattype['type'];
	response.send(HTTP.CREATED, { id: id, dimension: dim, type: type });
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
	cfg_cap.send(msg.ca_source, cfg_cap.responseTemplate(msg));
}

function cfgCmdStatus(msg)
{
	var key, inst, agg;
	var sendmsg = cfg_cap.responseTemplate(msg);

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

	cfg_cap.send(msg.ca_source, sendmsg);
}

function cfgNotifyAggregatorOnline(msg)
{
	var agg = {};

	agg.cag_hostname = msg.ca_hostname;
	agg.cag_routekey = msg.ca_source;
	agg.cag_agent_name = msg.ca_agent_name;
	agg.cag_agent_version = msg.ca_agent_version;
	agg.cag_os_name = msg.ca_os_name;
	agg.cag_os_release = msg.ca_os_release;
	agg.cag_os_revision = msg.ca_os_revision;
	agg.cag_ninsts = 0;

	/* XXX if already exists, it restarted, so need to update its state! */
	cfg_aggregators[agg.cag_hostname] = agg;

	cfg_log.info('aggregator started: %s', msg.ca_hostname);
}

function cfgNotifyInstrumenterOnline(msg)
{
	var inst, action;
	var mod, mstats, stat, mfields, field;
	var mm, ss, ff;

	if (msg.ca_hostname in cfg_instrumenters) {
		inst = cfg_instrumenters[msg.ca_hostname];
		action = 'restarted';
	} else {
		inst = cfg_instrumenters[msg.ca_hostname] = {};
		action = 'started';
	}

	inst.ins_hostname = msg.ca_hostname;
	inst.ins_routekey = msg.ca_source;
	inst.ins_agent_name = msg.ca_agent_name;
	inst.ins_agent_version = msg.ca_agent_version;
	inst.ins_os_name = msg.ca_os_name;
	inst.ins_os_release = msg.ca_os_release;
	inst.ins_os_revision = msg.ca_os_revision;
	inst.ins_nmetrics_avail = 0;
	inst.ins_ninsts = 0;

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

	/* XXX if already exists, it restarted, so need to update its state! */

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
