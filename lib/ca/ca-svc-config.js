/*
 * ca-svc-config.js: configuration service implementation and related functions
 */

var mod_ca = require('./ca-common');
var mod_cap = require('./ca-amqp-cap');
var mod_cahttp = require('./ca-http');
var mod_caerr = require('./ca-error');
var mod_capred = require('./ca-pred');
var mod_md = require('./ca-metadata');
var mod_profile = require('./ca-profile');
var mod_metric = require('./ca-metric');
var mod_log = require('./ca-log');
var mod_mapi = require('./ca-mapi');
var mod_task = require('./ca-task');
var ASSERT = require('assert').ok;
var HTTP = require('./http-constants');

var cai_agg_maxinsts = 50;		/* max # of insts per aggregator */
var cai_timeout_aggenable = 5 * 1000;	/* 5 seconds for aggregator */
var cai_timeout_instenable = 10 * 1000;	/* 10 seconds per instrumenter */
var cai_timeout_instdisable = 10 * 1000;

var cai_retain_min = 10;		/* min data retention time: 10 sec */
var cai_retain_default = 10 * 60;	/* default data retention: 10 min */

var cai_granularity_default = 1;		/* 1 second */
var cai_granularity_min = 1;			/* 1 second */
var cai_datapoints_max = 60 * 60;		/* 1 hour at per-second */

var cai_idle_max_min = 0;			/* never expire */
var cai_idle_max_max = 60 * 60 * 24 * 7;	/* 1 week */
var cai_idle_max_default = 60 * 60;		/* 1 hour */

var cai_http_uri_cust = '/customers';
var cai_http_uri_inst = '/instrumentations';
var cai_http_uri_raw  = '/value/raw';
var cai_http_uri_heatmap_image = '/value/heatmap/image';
var cai_http_uri_heatmap_details = '/value/heatmap/details';

var cfg_name = 'configsvc';		/* component name */
var cfg_vers = '0.0';			/* component version */
var cfg_http_port = mod_ca.ca_http_port_config;	/* HTTP port */
var cfg_http_uri_base = '/ca';		/* base URI for HTTP API */
var cfg_instn_max_peruser = 10;		/* maximum allowed instns per user */
var cfg_reaper_interval = 60 * 1000;	/* time between reaps (ms) */
var cfg_stash_vers_major = 0;		/* major rev of configsvc config */
var cfg_stash_vers_minor = 0;		/* minor rev of configsvc config */

/*
 * Implements the actual configuration service.  Service global state is stored
 * inside an instance of this class.  As with other service implementations, the
 * only public methods are stop(), start(), and routekey().
 */
function caConfigService(argv, loglevel)
{
	var svc = this;
	var mdpath;

	/* constants / tunables */
	this.cfg_name = cfg_name;
	this.cfg_vers = cfg_vers;
	this.cfg_http_port = cfg_http_port;
	this.cfg_http_uri_base = cfg_http_uri_base;
	this.cfg_instn_max_peruser = cfg_instn_max_peruser;
	this.cfg_reaper_interval = cfg_reaper_interval;

	/* configuration */
	this.cfg_sysinfo = mod_ca.caSysinfo(this.cfg_name, this.cfg_vers);
	this.cfg_mapicfg = mod_ca.caMapiConfig();
	this.cfg_queue = mod_cap.ca_amqp_key_base_config +
	    this.cfg_sysinfo.ca_hostname;

	if (arguments.length < 2)
		loglevel = mod_log.DBG;

	this.cfg_log = new mod_log.caLog({
	    out: process.stderr,
	    level: loglevel
	});

	ASSERT(argv.length > 0);
	mdpath = argv[0];

	/* log files */
	if (argv.length > 1) {
		this.cfg_dbglog = mod_log.caLogFromFile(argv[1],
		    { candrop: true }, mod_log.caLogError(this.cfg_log));
		this.cfg_log.info('Logging AMQP messages to "%s"', argv[1]);
	}

	if (argv.length > 2) {
		this.cfg_rqlog = mod_log.caLogFromFile(argv[2],
		    { candrop: true }, mod_log.caLogError(this.cfg_log));
		this.cfg_log.info('Logging HTTP requests to "%s"', argv[2]);
	}

	/* state */
	this.cfg_taskq = new mod_task.caTaskSerializer();
	this.cfg_metrics = new mod_metric.caMetricSet();
	this.cfg_metadata = new mod_metric.caMetricMetadata();
	this.cfg_aggrs = {};	/* known aggregators, by hostname */
	this.cfg_instrs = {};	/* known instrumenters, by hostname */
	this.cfg_xforms = {};	/* supported transformations */
	this.cfg_last = {};	/* last access time for each instn */

	/* AMQP connection */
	this.cfg_cap = new mod_cap.capAmqpCap({
	    dbglog: this.cfg_dbglog,
	    keepalive: true,
	    log: this.cfg_log,
	    queue: this.cfg_queue,
	    sysinfo: this.cfg_sysinfo
	});

	this.cfg_cap.bind(mod_cap.ca_amqp_key_config);
	this.cfg_cap.bind(mod_cap.ca_amqp_key_all);

	this.cfg_cap.on('msg-notify-configsvc_online', mod_ca.caNoop);
	this.cfg_cap.on('msg-notify-config_reset', mod_ca.caNoop);
	this.cfg_cap.on('msg-cmd-status', this.amqpStatus.bind(this));
	this.cfg_cap.on('msg-notify-aggregator_online',
	    this.amqpAggOnline.bind(this));
	this.cfg_cap.on('msg-notify-instrumenter_online',
	    this.amqpInstrOnline.bind(this));
	this.cfg_cap.on('msg-notify-log', this.amqpLog.bind(this));
	this.cfg_cap.on('msg-notify-instrumenter_error',
	    this.amqpInstrError.bind(this));

	/* HTTP server */
	this.cfg_http = new mod_cahttp.caHttpServer({
	    log: this.cfg_log,
	    port: this.cfg_http_port,
	    router: this.httpRouter.bind(this),
	    log_requests: this.cfg_rqlog
	});

	/* external services */
	if (this.cfg_mapicfg)
		this.cfg_mapi = new mod_mapi.caMapi(this.cfg_mapicfg);

	this.cfg_factory = new caInstrumentationFactory({
	    cap: this.cfg_cap,
	    log: this.cfg_log,
	    metrics: this.cfg_metrics,
	    metadata: this.cfg_metadata,
	    transformations: this.cfg_xforms,
	    aggregators: this.cfg_aggrs,
	    instrumenters: this.cfg_instrs,
	    uri_base: this.cfg_http_uri_base,
	    mapi: this.cfg_mapi,
	    next_id: function (custid) {
		if (custid === undefined)
			return (svc.cfg_nextid++);
		if (!(custid in svc.cfg_custs))
			svc.cfg_custs[custid] = { insts: {}, id: 1 };
		return (svc.cfg_custs[custid]['id']++);
	    }
	});

	this.cfg_mdmgr = new mod_md.caMetadataManager(
	    this.cfg_log, mdpath);
}

exports.caConfigService = caConfigService;

caConfigService.prototype.start = function (callback)
{
	var svc, stages, log;

	ASSERT(this.cfg_start === undefined, 'service cannot be restarted');

	this.cfg_start = new Date().getTime();

	svc = this;
	stages = [];
	log = this.cfg_log;

	log.info('Config service starting up (%s/%s)', this.cfg_name,
	    this.cfg_vers);
	log.info('%-12s %s', 'Hostname:', this.cfg_sysinfo.ca_hostname);
	log.info('%-12s %s', 'AMQP broker:',
	    JSON.stringify(this.cfg_cap.broker()));
	log.info('%-12s %s', 'Routing key:', this.cfg_queue);
	log.info('%-12s Port %d', 'HTTP server:', this.cfg_http_port);

	if (this.cfg_mapi) {
		log.info('%-12s %s:%s', 'MAPI host:', this.cfg_mapicfg.host,
		    this.cfg_mapicfg.port);
	} else {
		log.warn('MAPI_HOST, MAPI_PORT, MAPI_USER, or ' +
		    'MAPI_PASSWORD not set.  Per-customer use disabled.');
	}

	/* stage 1: load metadata from disk */
	stages.push(function (unused, subcallback) {
		svc.cfg_mdmgr.load(subcallback);
	});

	/* stage 2: load metadata into memory */
	stages.push(function (unused, subcallback) {
		svc.cfg_profiles = new mod_profile.caProfileManager();
		svc.cfg_profiles.load(svc.cfg_mdmgr);

		svc.cfg_profile_customer = svc.cfg_profiles.get('customer');
		if (!svc.cfg_profile_customer)
			return (subcallback(new caError(ECA_INVAL, null,
			    'customer profile not found')));

		svc.cfg_profile_operator = svc.cfg_profiles.get('operator');
		if (!svc.cfg_profile_operator)
			return (subcallback(new caError(ECA_INVAL, null,
			    'operator profile not found')));

		return (subcallback());
	});

	/* stage 3: start the HTTP server */
	stages.push(function (unused, subcallback) {
		log.info('Finished loading metadata');
		svc.cfg_http.start(subcallback);
	});

	/* stage 4: connect to the AMQP broker */
	stages.push(function (unused, subcallback) {
		log.info('HTTP server started');
		svc.cfg_cap.on('connected', svc.amqpConnected.bind(svc));
		svc.cfg_cap.start();
		subcallback();
	});

	/* stage 5: load configuration from stash service */
	stages.push(function (unused, subcallback) {
		svc.loadConfig(subcallback);
	});

	caRunStages(stages, null, function (err) {
		if (err)
			return (callback(new caError(err.code(), err,
			    'failed to start up server')));

		svc.cfg_reaper_timeout = setTimeout(
		    svc.tickReaper.bind(svc), svc.cfg_reaper_interval);

		return (callback());
	});
};

/*
 * Although the service can be stopped, it's not supported to start it back up.
 */
caConfigService.prototype.stop = function (callback)
{
	var svc = this;
	clearTimeout(this.cfg_reaper_timeout);
	this.cfg_http.stop(function () {
		svc.cfg_cap.on('disconnected', callback);
		svc.cfg_cap.stop();
	});
};

caConfigService.prototype.loadConfig = function (callback)
{
	var svc = this;

	/*
	 * In this first stage of loading configuration from the stash we
	 * retrieve the actual contents of our stash bucket.  We continue trying
	 * until we succeed or fail explicitly.  If the bucket doesn't exist,
	 * we'll populate it with an empty configuration.
	 */
	this.cfg_cap.cmdDataGet(mod_cap.ca_amqp_key_stash, 10000,
	    [ { bucket: 'ca.config.config' } ], function (err, results) {
		if (err) {
			if (err.code() != ECA_TIMEDOUT)
				return (callback(new caError(err.code(), err,
				    'failed to retrieve configuration')));

			svc.cfg_log.warn('timed out retrieving config; ' +
			    'trying again');
			return (svc.loadConfig(callback));
		}

		if ('result' in results[0])
			return (svc.loadConfigFini(results[0]['result'],
			    callback));

		if (results[0]['error']['code'] == ECA_NOENT)
			return (svc.populateConfig(callback));

		return (callback(new caError(ECA_REMOTE, null,
		    'failed remotely to retrieve configuration: %s',
		    results[0]['error']['message'])));
	});
};

/*
 * Load the given configuration (as stored in the stash).
 */
caConfigService.prototype.loadConfigFini = function (result, callback)
{
	var metadata, data, fqid, instn, hostname, host, ii;

	metadata = result['metadata'];
	if (metadata.cfg_vers_major > cfg_stash_vers_major)
		return (callback(new caError(ECA_INVAL, null,
		    'expected configsvc config version %s.%s (got %s.%s)',
		    cfg_stash_vers_major, cfg_stash_vers_minor,
		    metadata.cfg_vers_major, metadata.cfg_vers_minor)));

	try {
		data = JSON.parse(result['data']);
	} catch (ex) {
		return (callback(new caError(ECA_INVAL, ex,
		    'failed to parse configsvc config')));
	}

	this.cfg_log.info('restoring config from stash service');

	this.cfg_nextid = data['next_id'];
	this.cfg_instns = {};
	this.cfg_globals = data['global'];
	this.cfg_custs = data['customers'];

	for (fqid in data['instns']) {
		instn = data['instns'][fqid];
		hostname = instn['aggregator'];

		if (!(hostname in this.cfg_aggrs))
			this.cfg_aggrs[hostname] = {
			    cag_hostname: hostname,
			    cag_ninsts: 0,
			    cag_insts: {}
			};

		this.cfg_aggrs[hostname].cag_ninsts++;
		this.cfg_aggrs[hostname].cag_insts[fqid] = true;

		for (ii = 0; ii < instn['instrumenters'].length; ii++) {
			hostname = instn['instrumenters'][ii];

			if (!(hostname in this.cfg_instrs))
				this.cfg_instrs[hostname] = {
				    ins_hostname: hostname,
				    ins_ninsts: 0,
				    ins_insts: {}
				};

			this.cfg_instrs[hostname].ins_ninsts++;
			this.cfg_instrs[hostname].ins_insts[fqid] = true;
		}

		this.cfg_instns[fqid] = new caInstrumentation({
			aggregator: this.cfg_aggrs[instn['aggregator']],
			cust_id: instn['cust_id'],
			inst_id: instn['inst_id'],
			properties: instn['properties'],
			uri_base: this.cfg_http_uri_base,
			zonesbyhost: instn['zonesbyhost']
		});

		this.cfg_last[fqid] = new Date().getTime();

		this.cfg_log.info('restored instn "%s"', fqid);

		hostname = instn['aggregator'];
		if (this.cfg_aggrs[hostname].cag_routekey) {
			this.cfg_log.info('re-enabling aggr "%s" for ' +
			    'instn "%s"', hostname, fqid);
			this.instnReenableAggr(this.cfg_instns[fqid]);
		}

		for (ii = 0; ii < instn['instrumenters'].length; ii++) {
			hostname = instn['instrumenters'][ii];
			host = this.cfg_instrs[hostname];

			/*
			 * We may have a record for this instrumenter without
			 * any of the details if it's being used to instrument
			 * an instrumentation we restored from the stash but we
			 * haven't yet actually heard from it.  In that case,
			 * we'll re-enable the instrumenter when we hear from it
			 * next.
			 */
			if (!host.ins_routekey)
				continue;

			this.cfg_log.info('re-enabling instr "%s" for ' +
			    'instn "%s"', hostname, fqid);
			this.instnReenableInstr(this.cfg_instns[fqid], host);
		}
	}

	return (callback());
};

caConfigService.prototype.populateConfig = function (callback)
{
	var svc = this;

	/*
	 * Save a default empty configuration into the stash and then load that.
	 */
	this.cfg_instns = {};
	this.cfg_globals = {};
	this.cfg_custs = {};
	this.cfg_nextid = 1;

	this.save(function (err) {
		if (err)
			return (callback(err));

		svc.cfg_log.info('populated config; attempting to reload');
		return (svc.loadConfig(callback));
	});
};

/*
 * We destroy idle instrumentations to avoid accumulating garbage that users
 * have long forgotten about.  We do this by keeping track of the last accessed
 * time in cfg_last[fqid] and periodically (here in the reaper callback) destroy
 * those instrumentations whose last access time is longer ago than their
 * "idle-max" property.  All instrumentations get a fresh start when we come up
 * since we don't want to persist this configuration.  This mechanism will have
 * to be revisited once we start supporting instrumentations whose idle-max
 * values will exceed the expected lifetime of a single instance of this
 * service.
 */
caConfigService.prototype.tickReaper = function ()
{
	var log, now, fqid, instn, last, idlemax;

	log = this.cfg_log;
	now = new Date().getTime();

	for (fqid in this.cfg_instns) {
		instn = this.cfg_instns[fqid];
		last = this.cfg_last[fqid];
		ASSERT(last > 0);
		idlemax = instn.properties()['idle-max'];
		if (idlemax === 0 || now - last <= idlemax * 1000)
			continue;

		log.warn('expiring idle instrumentation "%s" (last: %s)',
		    fqid, new Date(last));
		this.reapInstn(instn);
	}

	this.cfg_reaper_last = now;
	this.cfg_reaper_timeout = setTimeout(this.tickReaper.bind(this),
	    this.cfg_reaper_interval);
};

caConfigService.prototype.reapInstn = function (instn)
{
	var svc, log;

	svc = this;
	log = this.cfg_log;

	this.cfg_taskq.task(function (taskcb) {
		svc.instnDelete(instn, function (err) {
			if (err)
				log.error('failed to expire idle instn ' +
				    '"%s": %r', instn.fqid(), err);
			taskcb();
		});
	});
};

/*
 * Invoked when we connect to the AMQP broker, both the first time and for
 * subsequent reconnects.
 */
caConfigService.prototype.amqpConnected = function ()
{
	this.cfg_log.info('AMQP broker connected');
	this.cfg_cap.sendNotifyCfgOnline(mod_cap.ca_amqp_key_all);
};

/*
 * Respond to the CA-AMQP "status" command with information about configured
 * instrumentations, instrumenters, and aggregators.
 */
caConfigService.prototype.amqpStatus = function (msg)
{
	var key, instr, aggr;
	var sendmsg = {};
	var svc = this;

	sendmsg.s_component = 'config';

	sendmsg.s_instrumenters = [];
	for (key in this.cfg_instrs) {
		instr = this.cfg_instrs[key];
		sendmsg.s_instrumenters.push({
		    sii_hostname: instr.ins_hostname,
		    sii_nmetrics_avail: 'unknown',
		    sii_ninsts: instr.ins_ninsts
		});
	}

	sendmsg.s_aggregators = [];
	for (key in this.cfg_aggrs) {
		aggr = this.cfg_aggrs[key];
		sendmsg.s_aggregators.push({
		    sia_hostname: aggr.cag_hostname,
		    sia_ninsts: aggr.cag_ninsts
		});
	}

	this.status(function (status) {
		sendmsg.s_status = status;
		svc.cfg_cap.sendCmdAckStatus(msg.ca_source, msg.ca_id, sendmsg);
	}, false, 0);
};

/*
 * Respond to the CA-AMQP "aggregator online" command.  We update our internal
 * information about this aggregator and its capabilities and then notify it of
 * any instrumentations it's supposed to be aggregating.
 */
caConfigService.prototype.amqpAggOnline = function (msg)
{
	var log, fqid, aggr, action, trans, ipaddr;

	log = this.cfg_log;

	if (!('ag_http_port' in msg)) {
		log.warn('ignoring aggonline msg with no port: %j', msg);
		return;
	}

	if (!('ag_transformations' in msg)) {
		log.warn('ignoring aggonline msg with no ' +
		    'transformations: %j', msg);
		return;
	}

	if (msg.ca_hostname in this.cfg_aggrs) {
		aggr = this.cfg_aggrs[msg.ca_hostname];
		action = 'restarted';
	} else {
		aggr = this.cfg_aggrs[msg.ca_hostname] = {};
		action = 'started';
		aggr.cag_ninsts = 0;
		aggr.cag_insts = {};
	}

	ipaddr = ('ag_http_ipaddr' in msg) ? msg.ag_http_ipaddr : '127.0.0.1';

	aggr.cag_hostname = msg.ca_hostname;
	aggr.cag_routekey = msg.ca_source;
	aggr.cag_agent_name = msg.ca_agent_name;
	aggr.cag_agent_version = msg.ca_agent_version;
	aggr.cag_os_name = msg.ca_os_name;
	aggr.cag_os_release = msg.ca_os_release;
	aggr.cag_os_revision = msg.ca_os_revision;
	aggr.cag_http_ipaddr = ipaddr;
	aggr.cag_http_port = msg.ag_http_port;
	aggr.cag_transformations = msg.ag_transformations;

	for (trans in aggr.cag_transformations) {
		if (trans in this.cfg_xforms)
			continue;

		this.cfg_xforms[trans] = aggr.cag_transformations[trans];
	}

	for (fqid in aggr.cag_insts)
		this.instnReenableAggr(this.cfg_instns[fqid]);

	log.info('aggregator %s: %s', action, msg.ca_hostname);
};

/*
 * Respond to the CA-AMQP "instrumenter online" command.  We update our internal
 * information about this instrumenter and its capabilities and then notify it
 * of any instrumentations it's supposed to have active.
 */
caConfigService.prototype.amqpInstrOnline = function (msg)
{
	var instr, instn, action, fqid, log, changed, svc;

	if (msg.ca_hostname in this.cfg_instrs) {
		instr = this.cfg_instrs[msg.ca_hostname];
		action = 'restarted';
	} else {
		instr = this.cfg_instrs[msg.ca_hostname] = {};
		action = 'started';
		instr.ins_insts = {};
		instr.ins_ninsts = 0;
	}

	log = this.cfg_log;
	log.info('instrumenter %s: %s', action, msg.ca_hostname);

	instr.ins_hostname = msg.ca_hostname;
	instr.ins_routekey = msg.ca_source;
	instr.ins_agent_name = msg.ca_agent_name;
	instr.ins_agent_version = msg.ca_agent_version;
	instr.ins_os_name = msg.ca_os_name;
	instr.ins_os_release = msg.ca_os_release;
	instr.ins_os_revision = msg.ca_os_revision;

	try {
		this.cfg_metadata.addFromHost(msg.ca_metadata, msg.ca_hostname);
	} catch (ex) {
		if (!(ex instanceof caError && ex.code() == ECA_INVAL))
			throw (ex);

		/*
		 * There's a conflict or otherwise invalid metadata.  Log the
		 * error and then forget about this instrumenter.
		 */
		log.warn('instrumenter %s: error processing metric ' +
		    'metadata: %r', msg.ca_hostname, ex);
		this.cfg_metrics.addFromHost([], msg.ca_hostname);
		return;
	}

	this.cfg_metrics.addFromHost(msg.ca_metadata['metrics'],
	    msg.ca_hostname);

	/*
	 * Re-enable any instrumentations we know are supposed to be active on
	 * this host.
	 */
	for (fqid in instr.ins_insts) {
		instn = this.cfg_instns[fqid];
		this.instnReenableInstr(instn, instr);
	}

	/*
	 * Enable global instrumentations that should be active on this host.
	 * This allows global instrumentations to automatically pick up new
	 * compute nodes as they're added to the cloud.  When this happens, we
	 * attempt to save our gobal configuration to the stash, though if this
	 * fails we won't bother trying to undo this.
	 */
	changed = false;
	for (fqid in this.cfg_globals) {
		if (fqid in instr.ins_insts)
			continue;

		log.info('extending instn "%s" to instrumenter "%s"',
		    fqid, msg.ca_hostname);

		changed = true;
		instr.ins_insts[fqid] = true;
		instn = this.cfg_instns[fqid];
		this.instnReenableInstr(instn, instr);
	}

	if (!changed)
		return;

	svc = this;
	this.cfg_taskq.task(function (taskcb) {
		svc.save(function (err) {
			if (err)
				log.warn('failed to save config after ' +
				    'extending instns to instr "%s": %r',
				    msg.ca_hostname, err);

			taskcb();
		});
	});
};

/*
 * Handle an incoming CA-AMQP "log" message.  Just log the message.
 */
caConfigService.prototype.amqpLog = function (msg)
{
	if (!('l_message' in msg)) {
		this.cfg_log.warn('dropped log message with missing message');
		return;
	}

	this.cfg_log.warn('from %s: %s %s', msg.ca_hostname, msg.ca_time,
	    msg.l_message);
};

/*
 * Handle an incoming CA-AMQP "instrumenter error" message.  Just log the error.
 */
caConfigService.prototype.amqpInstrError = function (msg)
{
	if (!('ins_inst_id' in msg) || !('ins_error' in msg) ||
	    !('ins_status' in msg) || (msg['ins_status'] != 'enabled' &&
	    msg['ins_status'] != 'disabled')) {
		this.cfg_log.warn('dropping malformed instr error message');
		return;
	}

	if (!(msg.ca_hostname in this.cfg_instrs)) {
		this.cfg_log.warn('dropping instr error message for unknown ' +
		    'host "%s"', msg.ca_hostname);
		return;
	}

	this.cfg_log.error('host "%s" reports instrumenter error (now %s): %s',
	    msg.ca_hostname, msg.ins_status, msg.ins_error);
};

/*
 * Given a "connect" HTTP server, register handlers for our API's resources.
 */
caConfigService.prototype.httpRouter = function (server)
{
	var infixes, resources;
	var ii, jj, base, uri, impl;

	infixes = [ '', '/customers/:custid' ];

	resources = [ {
	    method: 'get',
	    suffix: '',
	    impl: this.httpConfigList
	}, {
	    method: 'get',
	    suffix: '/metrics',
	    impl: this.httpLegacyMetricsList
	}, {
	    method: 'get',
	    suffix: '/types',
	    impl: this.httpLegacyTypesList
	}, {
	    method: 'get',
	    suffix: '/transformations',
	    impl: this.httpLegacyXformsList
	}, {
	    method: 'get',
	    suffix: '/instrumentations',
	    impl: this.httpInstnsList
	}, {
	    method: 'post',
	    suffix: '/instrumentations',
	    impl: this.httpInstnCreate
	}, {
	    method: 'del',
	    suffix: '/instrumentations/:instid',
	    impl: this.httpInstnDelete
	}, {
	    method: 'get',
	    suffix: '/instrumentations/:instid',
	    impl: this.httpInstnGetProps
	}, {
	    method: 'put',
	    suffix: '/instrumentations/:instid',
	    impl: this.httpInstnSetProps
	}, {
	    method: 'get',
	    suffix: '/instrumentations/:instid/value',
	    impl: this.httpInstnValue
	}, {
	    method: 'get',
	    suffix: '/instrumentations/:instid/value/*',
	    impl: this.httpInstnValue
	} ];

	server.get(this.cfg_http_uri_base + '/admin/status',
	    this.httpAdminStatus.bind(this));

	for (ii = 0; ii < infixes.length; ii++) {
		base = this.cfg_http_uri_base + infixes[ii];

		for (jj = 0; jj < resources.length; jj++) {
			uri = base + resources[jj]['suffix'];
			impl = resources[jj]['impl'].bind(this);
			server[resources[jj]['method']](uri, impl);
		}
	}
};

/*
 * Checks whether we've loaded our persistent configuration yet.  If not, we
 * fail requests with 503 (service unavailable).
 */
caConfigService.prototype.httpReady = function (request, response)
{
	if (this.cfg_instns)
		return (true);

	response.send(HTTP.ESRVUNAVAIL);
	return (false);
};

/*
 * Return the metric set appropriate for the given request based on whether the
 * request is scoped to a particular profile.
 */
caConfigService.prototype.httpMetricSet = function (request)
{
	var mset = this.cfg_metrics;

	/*
	 * Customers (identified by the customer ID in the URL) are always
	 * limited by the "customer" profile.
	 */
	if (request.params['custid'] !== undefined)
		return (this.cfg_profile_customer.metrics().intersection(mset));

	/*
	 * Operators are allowed to explicitly override profiles.  This is used
	 * primarily by the tests to avoid having to to write tests that match
	 * actual profiles.
	 */
	if (request.ca_params['profile'] == 'none')
		return (mset);

	return (this.cfg_profile_operator.metrics().intersection(mset));
};

/*
 * Return the instrumentation specified by the given request URI, or "undefined"
 * if none is specified.  If this function returns "undefined", it has already
 * sent an appropriate error response to the client.
 */
caConfigService.prototype.httpInstn = function (request, response)
{
	var custid, instid, fqid, instn;

	if (!this.httpReady(request, response))
		return (undefined);

	custid = request.params['custid'];
	instid = request.params['instid'];
	fqid = mod_ca.caQualifiedId(custid, instid);
	instn = this.cfg_instns[fqid];

	if (!instn) {
		response.send(HTTP.ENOTFOUND);
		return (undefined);
	}

	this.cfg_last[fqid] = new Date().getTime();
	return (instn);
};

/*
 * Reads instrumentation properties from form fields or the request body.
 */
caConfigService.prototype.httpInstnProps = function (request)
{
	var actuals, props, fields, ii;

	/*
	 * If the user specified a JSON object, we use that.  Otherwise, we
	 * assume they specified parameters in form fields.
	 */
	if (request.ca_json && typeof (request.ca_json) == typeof ({}))
		actuals = request.ca_json;
	else
		actuals = request.ca_params;

	props = {};
	fields = [ 'module', 'stat', 'predicate', 'decomposition', 'enabled',
	    'retention-time', 'idle-max', 'granularity', 'persist-data' ];

	for (ii = 0; ii < fields.length; ii++) {
		if (fields[ii] in actuals)
			props[fields[ii]] = actuals[fields[ii]];
	}

	return (props);
};

/*
 * Respond to HTTP requests for /ca/admin/status.  Return basic status info.
 */
caConfigService.prototype.httpAdminStatus = function (request, response)
{
	var params, recurse, timeout;

	params = {
	    recurse: { type: 'boolean',	default: false },
	    timeout: { type: 'number',	default: 5,	min: 1, max: 60 }
	};

	try {
		recurse = mod_ca.caHttpParam(params,
		    request.ca_params, 'recurse');
		timeout = mod_ca.caHttpParam(params,
		    request.ca_params, 'timeout');
	} catch (ex) {
		if (!(ex instanceof caValidationError))
			throw (ex);

		response.sendError(ex);
		return;
	}

	this.status(function (result) {
		response.send(HTTP.OK, result);
	}, recurse, timeout * 1000);
};

/*
 * Respond to HTTP requests for /ca[/customers/:custid]/.  Return the list of
 * available metrics and related metadata.
 */
caConfigService.prototype.httpConfigList = function (request, response)
{
	var set, ret;

	set = this.httpMetricSet(request);
	ret = mod_metric.caMetricHttpSerialize(set, this.cfg_metadata);
	ret['transformations'] = this.cfg_xforms;
	response.send(HTTP.OK, ret);
};

/*
 * Respond to HTTP requests for the legacy entry point
 * /ca[/customers/:custid]/metrics.  Returns a list of available metrics.
 */
caConfigService.prototype.httpLegacyMetricsList = function (request, response)
{
	var set, metrics, metric, module, stat, fields, field;
	var fieldtype, md, ret, ii, jj;

	md = this.cfg_metadata;
	set = this.httpMetricSet(request);
	ret = {};

	metrics = set.baseMetrics();
	for (ii = 0; ii < metrics.length; ii++) {
		metric = metrics[ii];
		module = metric.module();
		stat = metric.stat();

		if (!(module in ret))
			ret[module] = {
			    label: md.moduleLabel(module),
			    stats: {}
			};

		ret[module]['stats'][stat] = {
		    label: md.metricLabel(module, stat),
		    type: 'unused',
		    fields: {}
		};

		fields = metric.fields();
		for (jj = 0; jj < fields.length; jj++) {
			field = fields[jj];

			if (field == 'latency' || field == 'runtime' ||
			    field == 'cputime')
				fieldtype = 'latency';
			else if (md.fieldArity(field) == 'numeric')
				fieldtype = 'number';
			else
				fieldtype = 'string';

			ret[module]['stats'][stat]['fields'][field] = {
			    label: md.fieldLabel(field),
			    type: fieldtype
			};
		}
	}

	response.send(HTTP.OK, ret);
};

/*
 * Respond to HTTP requests for the legacy entry point
 * /ca[/customers/:custid]/types.  Returns a list of types used in the available
 * metrics.
 */
caConfigService.prototype.httpLegacyTypesList = function (request, response)
{
	response.send(HTTP.OK, {
	    latency: 'numeric',
	    string: 'discrete',
	    number: 'numeric'
	});
};

/*
 * Respond to HTTP requests for the legacy entry point
 * /ca[/customers/:custid]/transformations.  Returns a list of transformations
 * used in the available metrics.
 */
caConfigService.prototype.httpLegacyXformsList = function (request, response)
{
	response.send(HTTP.OK, this.cfg_xforms);
};

/*
 * Respond to HTTP requests for /ca[/customers/:custid]/instrumentations.  Lists
 * all active instrumentations.
 */
caConfigService.prototype.httpInstnsList = function (request, response)
{
	var custid, scope, fqid, rv;

	if (!this.httpReady(request, response))
		return;

	custid = request.params['custid'];

	if (custid === undefined && request.ca_params['all'] === 'true')
		scope = this.cfg_instns;
	else if (custid === undefined)
		scope = this.cfg_globals;
	else if (custid in this.cfg_custs)
		scope = this.cfg_custs[custid]['insts'];
	else
		scope = {};

	rv = [];
	for (fqid in scope)
		rv.push(this.cfg_instns[fqid].properties());

	response.send(HTTP.OK, rv);
};

/*
 * Respond to HTTP requests for GET
 * /ca[/customers/:custid]/instrumentations/:instid.  Returns properties for the
 * specified instrumentation.
 */
caConfigService.prototype.httpInstnGetProps = function (request, response)
{
	var instn;

	instn = this.httpInstn(request, response);
	if (!instn)
		return;

	response.send(HTTP.OK, instn.properties());
};

/*
 * Respond to HTTP requests for POST /ca[/customers/:custid]/instrumentations.
 * Creates a new instrumentation.
 */
caConfigService.prototype.httpInstnCreate = function (request, response)
{
	var svc, custid, props, ninstns, set, log;

	if (!this.httpReady(request, response))
		return;

	svc = this;
	custid = request.params['custid'];
	props = this.httpInstnProps(request);
	log = this.cfg_log;

	log.info('request to instrument:\n%j', props);

	/*
	 * For customer requests, we impose a limit on the number of active
	 * instrumentations at any given time to prevent individual customers
	 * from over-taxing our infrastructure.  Global instrumentations (which
	 * can only be created by administrators) have no such limits.
	 */
	if (custid !== undefined) {
		ninstns = custid in this.cfg_custs ?
		    Object.keys(this.cfg_custs[custid]['insts']).length : 0;
		ASSERT(ninstns <= cfg_instn_max_peruser);
		if (ninstns == cfg_instn_max_peruser) {
			log.warn('user %s attempted to exceed max # ' +
			    'of instrumentations allowed', custid);
			response.sendError(new caValidationError(
			    caSprintf('only %d instrumentations allowed',
			    cfg_instn_max_peruser)));
			return;
		}
	}

	set = this.httpMetricSet(request);
	this.cfg_factory.create(custid, props, set, function (err, resp) {
		if (err) {
			log.error('failed to create instn: %r', err);
			response.sendError(err);
			return;
		}

		svc.cfg_taskq.task(function (taskcb) {
			svc.httpCreateFini(response, resp, taskcb);
		});
	});
};

caConfigService.prototype.httpCreateFini = function (response, resp, taskcb)
{
	var svc, log, instn, fqid, custid, props, headers, scope;

	svc = this;
	log = this.cfg_log;
	instn = resp['inst'];
	fqid = instn.fqid();
	custid = instn.custid();
	props = caDeepCopy(instn.properties());
	props['warnings'] = resp['warnings'];
	headers = { 'Location': props['uri'] };

	if (custid === undefined) {
		scope = this.cfg_globals;
	} else {
		if (!(custid in this.cfg_custs))
			this.cfg_custs[custid] = { insts: {}, id: 1 };
		scope = this.cfg_custs[custid]['insts'];
	}

	svc.cfg_instns[fqid] = instn;
	svc.cfg_last[fqid] = new Date().getTime();
	scope[fqid] = true;

	this.save(function (err) {
		if (err) {
			delete (scope[fqid]);
			delete (svc.cfg_instns[fqid]);
			delete (svc.cfg_last[fqid]);

			log.error('failed to save instn "%s": %r', fqid, err);

			svc.cfg_factory.destroy(instn, function (suberr) {
				response.sendError(err);
				taskcb();

				if (!suberr)
					return;

				log.error('failed to destroy aborted ' +
				    'instn "%s": %r', fqid, suberr);
			});

			return;
		}

		response.send(HTTP.CREATED, props, headers);
		taskcb();
	});
};

/*
 * Respond to HTTP requests for DELETE
 * /ca[/customers/:custid]/instrumentations/:instid.  Deletes the specified
 * instrumentation.
 */
caConfigService.prototype.httpInstnDelete = function (request, response)
{
	var svc = this;

	this.cfg_taskq.task(function (taskcb) {
		var instn = svc.httpInstn(request, response);

		if (!instn) {
			taskcb();
			return;
		}

		svc.instnDelete(instn, function (err) {
			if (err)
				response.sendError(err);
			else
				response.send(HTTP.NOCONTENT);

			taskcb();
		});
	});
};

/*
 * Respond to HTTP requests for PUT
 * /ca[/customers/:custid]/instrumentations/:instid.  Sets and returns
 * properties for the specified instrumentation.
 */
caConfigService.prototype.httpInstnSetProps = function (request, response)
{
	var svc, props;

	svc = this;
	props = this.httpInstnProps(request);

	this.cfg_taskq.task(function (taskcb) {
		var instn = svc.httpInstn(request, response);

		if (!instn) {
			taskcb();
			return;
		}

		svc.instnSetProps(instn, props, function (err) {
			if (err)
				response.sendError(err);
			else
				response.send(HTTP.OK, instn.properties());

			taskcb();
		});
	});
};

/*
 * Respond to HTTP requests for
 * /ca[/customers/:custid]/instrumentations/:instid/value[/...].  Forwards the
 * request to the corresponding aggregator.
 */
caConfigService.prototype.httpInstnValue = function (request, response)
{
	var instn, aggr, ipaddr, port;

	instn = this.httpInstn(request, response);
	if (!instn)
		return (undefined);

	aggr = instn.aggregator();
	ipaddr = aggr.cag_http_ipaddr;
	port = aggr.cag_http_port;

	if (!ipaddr || !port)
		return (response.send(HTTP.ESRVUNAVAIL));

	return (mod_cahttp.caHttpForward(request, response, ipaddr, port,
	    this.cfg_log));
};

caConfigService.prototype.instnDelete = function (instn, callback)
{
	var svc, fqid, custid, scope;

	svc = this;
	fqid = instn.fqid();
	custid = instn.custid();
	scope = custid === undefined ?
	    this.cfg_globals : this.cfg_custs[custid]['insts'];

	ASSERT(fqid in scope);
	ASSERT(this.cfg_instns[fqid] == instn);

	delete (scope[fqid]);
	delete (this.cfg_instns[fqid]);
	delete (this.cfg_last[fqid]);

	this.save(function (err) {
		if (err) {
			scope[fqid] = true;
			svc.cfg_instns[fqid] = instn;
			svc.cfg_last[fqid] = new Date().getTime();
			return (callback(err));
		}

		return (svc.cfg_factory.destroy(instn, function (suberr) {
			/*
			 * We could return back to the caller as soon as we
			 * update the persistent state, since after that it's
			 * our responsibility to clean up.  But it makes things
			 * much easier to verify to wait until after we've at
			 * least tried.
			 */
			callback();

			if (!suberr)
				return;

			svc.cfg_log.warn('error while deleting instn "%s": %r',
			    fqid, suberr);
		}));
	});
};

caConfigService.prototype.instnSetProps = function (instn, props, callback)
{
	var svc = this;

	this.cfg_factory.setProperties(instn, props, function (err) {
		if (err)
			return (callback(err));

		return (svc.save(callback));
	});
};

caConfigService.prototype.instnReenableAggr = function (instn)
{
	var log = this.cfg_log;

	this.cfg_factory.reenableAggregator(instn, function (err) {
		if (err)
			log.error('failed to reenable aggr "%s" on "%s": %r',
			    instn.fqid(), instn.aggregator().cag_hostname, err);
	});
};

caConfigService.prototype.instnReenableInstr = function (instn, instr)
{
	var log = this.cfg_log;

	this.cfg_factory.enableInstrumenter(instn, instr, function (err) {
		if (err)
			log.error('failed to reenable instr "%s" on "%s": %r',
			    instn.fqid(), instr.ins_hostname, err);
	});
};

/*
 * Saves the current configuration to the stash.  This is used by various
 * routines which change our configuration.  Callers must be smart enough to
 * unwind such state changes if this operation fails.  To keep state consistent
 * in the face of potential failures and the subsequent unwinding, there can
 * only be one outstanding configuration change at a time, which is facilitated
 * by running these changes through a task serializer (cfg_taskq).  This could
 * be revisited in the future by storing the configuration in discrete buckets
 * per instrumentation rather than a single bucket.
 */
caConfigService.prototype.save = function (callback)
{
	var metadata, data, fqid, instn, hostname, instr, payload;

	metadata = {
	    cfg_modified: new Date(),
	    cfg_creator: this.cfg_sysinfo,
	    cfg_vers_major: cfg_stash_vers_major,
	    cfg_vers_minor: cfg_stash_vers_minor
	};

	data = {
	    next_id: this.cfg_nextid,
	    instns: {},
	    global: this.cfg_globals,
	    customers: this.cfg_custs
	};

	for (fqid in this.cfg_instns) {
		instn = this.cfg_instns[fqid];
		data['instns'][fqid] = {
		    cust_id: instn.custid(),
		    inst_id: instn.instid(),
		    properties: instn.properties(),
		    zonesbyhost: instn.rawzonesbyhost(),
		    aggregator: instn.aggregator().cag_hostname,
		    instrumenters: []
		};
	}

	for (hostname in this.cfg_instrs) {
		instr = this.cfg_instrs[hostname];
		for (fqid in instr.ins_insts) {
			/*
			 * In the delete case, we've removed state from
			 * cfg_instns but not yet cfg_instrs.
			 */
			if (!(fqid in data['instns']))
				continue;
			data['instns'][fqid]['instrumenters'].push(hostname);
		}
	}

	payload = JSON.stringify(data);

	this.cfg_cap.cmdDataPut(mod_cap.ca_amqp_key_stash, 10000, [ {
	    bucket: 'ca.config.config',
	    metadata: metadata,
	    data: payload
	} ], function (err, results) {
		if (err)
			return (callback(new caError(err.code(), err,
			    'failed to save configuration')));

		if (!('result' in results[0]))
			return (callback(new caError(ECA_REMOTE, null,
			    'failed remotely to save configuration: %j',
			    results[0])));

		return (callback());
	});
};

/*
 * Retrieves an object describing the current service state for debugging and
 * monitoring.  Values include configuration constants (like remote service
 * hostnames), tunables, internal state counters, etc.  The following arguments
 * must be specified:
 *
 *	callback	Invoked upon completion with one argument representing
 *			the current status.  The callback may be invoked
 *			synchronously if "recurse" is false.
 *
 *	recurse		Send AMQP status messages to other components in the
 *			system (instrumenters and aggregators) to retrieve their
 *			status as well.  If any of these commands fail or
 *			time out, the corresponding entries will contain an
 *			'error' describing what happened.
 *
 *	timeout		When recurse is true, this number denotes the maximum
 *			time to wait (in milliseconds) for any the status
 *			requests to other components before timing out.
 */
caConfigService.prototype.status = function (callback, recurse, timeout)
{
	var ret, key, obj;
	var nrequests, checkdone, doamqp;
	var start = new Date().getTime();

	checkdone = function () {
		ASSERT(nrequests > 0);
		if (--nrequests !== 0)
			return;

		ret['request_latency'] = new Date().getTime() - start;
		callback(ret);
	};

	nrequests = 1;
	ret = {};
	ret['heap'] = process.memoryUsage();
	ret['http'] = this.cfg_http.info();
	ret['amqp_cap'] = this.cfg_cap.info();
	ret['sysinfo'] = this.cfg_sysinfo;
	ret['started'] = this.cfg_start;
	ret['uptime'] = start - this.cfg_start;

	ret['cfg_http_port'] = this.cfg_http_port;
	ret['cfg_instn_max_peruser'] = this.cfg_instn_max_peruser;
	ret['cfg_reaper_interval'] = this.cfg_reaper_interval;
	ret['cfg_reaper_last'] = this.cfg_reaper_last;
	ret['cfg_factory'] = this.cfg_factory.info();
	ret['cfg_metadata'] = this.cfg_metadata;

	ret['cfg_aggregators'] = {};
	for (key in this.cfg_aggrs) {
		obj = this.cfg_aggrs[key];
		ret['cfg_aggregators'][key] = {
		    hostname: obj.cag_hostname,
		    routekey: obj.cag_routekey,
		    http_port: obj.cag_http_port,
		    transformations: obj.cag_transformations,
		    ninsts: obj.cag_ninsts,
		    insts: Object.keys(obj.cag_insts)
		};
	}

	ret['cfg_instrumenters'] = {};
	for (key in this.cfg_instrs) {
		obj = this.cfg_instrs[key];

		ret['cfg_instrumenters'][key] = {
		    hostname: obj.ins_hostname,
		    routekey: obj.ins_routekey,
		    insts: Object.keys(obj.ins_insts)
		};

		ret['cfg_instrumenters'][key]['ninsts'] =
		    ret['cfg_instrumenters'][key]['insts'].length;
	}

	ret['cfg_insts'] = {};
	for (key in this.cfg_instns) {
		obj = this.cfg_instns[key];

		ret['cfg_insts'][key] = caDeepCopy(obj.properties());
		ret['cfg_insts'][key]['aggregator'] =
		    obj.aggregator().cag_hostname;
		ret['cfg_insts'][key]['custid'] = obj.custid();
	}

	ret['instn-scopes'] = {};
	ret['instn-scopes']['global'] = Object.keys(this.cfg_globals);
	for (key in this.cfg_custs)
		ret['instn-scopes']['cust:' + key] =
		    Object.keys(this.cfg_custs[key]['insts']);

	if (!recurse)
		return (checkdone());

	/*
	 * The user wants information about each related service.  We make a
	 * subrequest to each one and store the results in our return value.
	 */
	ASSERT(timeout && typeof (timeout) == typeof (0));
	doamqp = function (type, hostname) {
		return (function (err, result) {
			if (err)
				ret[type][hostname] = { error: err };
			else
				ret[type][hostname] = result.s_status;

			checkdone();
		});
	};

	ret['aggregators'] = {};
	for (key in this.cfg_aggrs) {
		obj = this.cfg_aggrs[key];
		ret['aggregators'][key] = { error: 'timed out' };
		if (!obj.cag_routekey)
			continue;
		nrequests++;
		this.cfg_cap.cmdStatus(obj.cag_routekey, timeout,
		    doamqp('aggregators', key));
	}

	ret['instrumenters'] = {};
	for (key in this.cfg_instrs) {
		obj = this.cfg_instrs[key];
		ret['instrumenters'][key] = { error: 'timed out' };
		if (!obj.ins_routekey)
			continue;
		nrequests++;
		this.cfg_cap.cmdStatus(obj.ins_routekey, timeout,
		    doamqp('instrumenters', key));
	}

	return (checkdone());
};


/*
 * An instrumentation factory encapsulates the configuration and steps required
 * to create, modify, and delete an instrumentation.  This includes input
 * validation and communicating with both aggregators and instrumenters.
 * Ideally, the configuration service itself would be simply an HTTP wrapper
 * around this object.  Currently, the global state of instrumentations,
 * aggregators, and instrumenters is still maintained by the configuration
 * service, so this component assumes knowledge of the internal configuration
 * service data structures.  However, this component has *no* direct
 * communication with the user (i.e. no knowledge of HTTP) and this should stay
 * that way.  The caError framework provides enough abstraction that the
 * configuration service can easily convert our exceptions to user-facing error
 * messages.
 *
 * The "conf" argument must contain the following members:
 *
 *	cap		AMQP-CAP wrapper
 *
 *	log		log for debugging
 *
 *	metrics		list of available metrics (caMetricSet)
 *
 *	metadata	metric metadata (caMetricMetadata)
 *
 *	transformations	list of available transformations
 *
 *	aggregators	list of aggregator hostnames (default: none)
 *
 *	instrumenters	list of instrumenter hostnames (default: none)
 *
 *	uri_base	base for instrumentation URIs
 *
 * The "conf" argument may also contain the following members:
 *
 *	mapi		caMapi object for querying MAPI
 */
function caInstrumentationFactory(conf)
{
	var factory;

	ASSERT(conf.cap);
	this.cif_cap = conf.cap;
	ASSERT(conf.log);
	this.cif_log = conf.log;
	ASSERT(conf.metrics);
	this.cif_metrics = conf.metrics;
	ASSERT(conf.transformations);
	this.cif_transformations = conf.transformations;
	ASSERT(conf.aggregators);
	this.cif_aggregators = conf.aggregators;
	ASSERT(conf.instrumenters);
	this.cif_instrumenters = conf.instrumenters;
	ASSERT(conf.uri_base);
	this.cif_uri_base = conf.uri_base;
	ASSERT(conf.metadata);
	this.cif_metadata = conf.metadata;
	ASSERT(conf.next_id);
	this.cif_nextid = conf.next_id;

	this.cif_mapi = conf.mapi;

	factory = this;
	this.cif_stages_create = [
		this.stageValidate,
		this.stageCheckContainers,
		this.stageCheckHosts,
		this.stageEnableAggregator,
		this.stageEnableInstrumenters,
		this.stageComplete
	].map(function (method) {
		return (mod_ca.caWrapMethod(factory, method));
	});
}

exports.caInstrumentationFactory = caInstrumentationFactory;

/*
 * Returns debugging and monitoring information.
 */
caInstrumentationFactory.prototype.info = function ()
{
	var ret = {};

	ret['cai_agg_maxinsts'] = cai_agg_maxinsts;
	ret['cai_timeout_aggenable'] = cai_timeout_aggenable;
	ret['cai_timeout_instenable'] = cai_timeout_instenable;
	ret['cai_timeout_instdisable'] = cai_timeout_instdisable;
	ret['cai_retain_min'] = cai_retain_min;
	ret['cai_retain_default'] = cai_retain_default;
	ret['cai_datapoints_max'] = cai_datapoints_max;
	ret['cai_idle_max_min'] = cai_idle_max_min;
	ret['cai_idle_max_max'] = cai_idle_max_max;
	ret['cai_idle_max_default'] = cai_idle_max_default;

	return (ret);
};

/*
 * Create a new instrumentation scoped to the given customer id and with the
 * given properties.  Upon successful completion, the callback will be invoked
 * with a null error object and a non-null "instrumentation" object -- an
 * instance of class caInstrumentation below.
 */
caInstrumentationFactory.prototype.create = function (custid, props, pset,
    callback)
{
	var request;

	request = {
	    tk: new mod_ca.caTimeKeeper('instn create'),
	    cust_id: custid,
	    properties: props,
	    pset: pset,
	    callback: callback,
	    warnings: []
	};

	caRunStages(this.cif_stages_create, request, callback);
	return (request);
};

/*
 * Deletes the given instrumentation.
 */
caInstrumentationFactory.prototype.destroy = function (inst, callback)
{
	var fqid, instrs, tasks, factory, log;

	fqid = inst.fqid();
	tasks = [];
	factory = this;
	log = this.cif_log;

	log.dbg('deleting instrumentation %s', inst.fqid());

	tasks.push(function (taskcb) {
		factory.disableAggregator(inst, taskcb);
	});

	instrs = Object.keys(this.cif_instrumenters);
	instrs.forEach(function (hostname) {
		var instrumenter;

		instrumenter = factory.cif_instrumenters[hostname];
		if (fqid in instrumenter.ins_insts) {
			instrumenter.ins_ninsts--;
			delete (instrumenter.ins_insts[fqid]);
		}

		tasks.push(function (taskcb) {
			if (!instrumenter.ins_routekey) {
				log.warn('failed to disable "%s" on instr ' +
				    '"%s" failed because no routekey present',
				    fqid, hostname);
				taskcb();
				return;
			}

			factory.disableInstrumenter(inst, instrumenter, taskcb);
		});
	});

	caRunParallel(tasks, function (rv) {
		var errors, ii, host, type;

		errors = rv['errlocs'].map(function (idx) {
			return (rv['results'][idx]['error']);
		});

		if (errors.length === 0)
			return (callback());

		for (ii = 0; ii < errors.length; ii++) {
			if (rv['errlocs'][ii] === 0) {
				host = inst.aggregator().cag_hostname;
				type = 'aggregator';
			} else {
				host = instrs[rv['errlocs'][ii] - 1];
				type = 'instrumenter';
			}

			log.warn('failed to disable "%s" on %s "%s": %r',
			    fqid, type, host, errors[ii]);
		}

		return (callback(new caError(ECA_REMOTE, errors[0],
		    'failed to disable %d services; saving first error',
		    errors.length)));
	});
};

/*
 * Re-enable aggregation for a particular instrumentation.  Aggregation is
 * initially enabled when the instrumentation is created, but must be explicitly
 * reenabled when the aggregator restarts or the instrumentation's properties
 * change.
 */
caInstrumentationFactory.prototype.reenableAggregator = function (inst,
    callback)
{
	var aggregator, instkey;

	ASSERT(inst instanceof caInstrumentation);
	aggregator = inst.aggregator();
	instkey = mod_cap.caRouteKeyForInst(inst.fqid());

	this.cif_cap.cmdEnableAgg(aggregator.cag_routekey, inst.fqid(),
	    instkey, inst.properties(), cai_timeout_aggenable, function () {
		if (callback)
			callback.apply(null, arguments);
	    });
};

/*
 * Disable an instrumentation on an aggregator.
 */
caInstrumentationFactory.prototype.disableAggregator = function (instn,
    callback)
{
	var aggregator, fqid;

	ASSERT(instn instanceof caInstrumentation);
	aggregator = instn.aggregator();
	fqid = instn.fqid();

	ASSERT(fqid in aggregator.cag_insts);
	delete (aggregator.cag_insts[fqid]);
	aggregator.cag_ninsts--;

	this.cif_cap.cmdDisableAgg(aggregator.cag_routekey, fqid,
	    cai_timeout_aggenable, function () {
		if (callback)
			callback.apply(null, arguments);
	    });
};

/*
 * Enable data collection for a particular instrumentation on a particular host.
 * Instrumentation is initially enabled when the instrumentation is created and
 * must be explicitly reenabled when the instrumenter restarts.
 */
caInstrumentationFactory.prototype.enableInstrumenter = function (inst,
    instrumenter, callback)
{
	var fqid = inst.fqid();
	var instkey, zones;

	instkey = mod_cap.caRouteKeyForInst(fqid);
	zones = inst.zonesbyhost(instrumenter.ins_hostname);
	ASSERT(zones === undefined || zones.length > 0);

	this.cif_cap.cmdEnableInst(instrumenter.ins_routekey,
	    fqid, instkey, inst.properties(), zones, cai_timeout_instenable,
	    function (err, okay) {
		ASSERT(err || okay);
		if (callback)
			callback.apply(null, arguments);
	    });
};

/*
 * Disable data collection for an instrumentation on a particular host.
 */
caInstrumentationFactory.prototype.disableInstrumenter = function (inst,
    instrumenter, callback)
{
	var fqid = inst.fqid();

	ASSERT(!instrumenter.ins_insts[fqid]);

	this.cif_cap.cmdDisableInst(instrumenter.ins_routekey, fqid,
	    cai_timeout_instdisable, function (err, okay) {
		ASSERT(err || okay);
		if (callback)
			callback.apply(null, arguments);
	    });
};

/*
 * Update the properties for a particular instrumentation.  Attempts to change
 * immutable properties are ignored (just like attempts to change non-existent
 * properties).
 */
caInstrumentationFactory.prototype.setProperties = function (inst, props,
    callback)
{
	var mutables, ii, newprops = caDeepCopy(inst.properties());

	this.cif_log.dbg('setting new properties for "%s": %j',
	    inst.fqid(), props);

	try {
		mutables = caInstValidateMutableFields(props,
		    inst.custid() === undefined);
	} catch (ex) {
		return (callback(ex));
	}

	for (ii = 0; ii < mutables.length; ii++) {
		if (mutables[ii] in props)
			newprops[mutables[ii]] = props[mutables[ii]];
	}

	inst.loadProperties(newprops);
	return (this.reenableAggregator(inst, callback));
};

/*
 * [private] Create Stage: Validate instrumentation
 */
caInstrumentationFactory.prototype.stageValidate = function (request, callback)
{
	var props, metric, fields, mfields, fieldarities, ii;

	props = request.properties;

	/*
	 * "module" and "stat" are always required.
	 */
	if (!props['module'])
		return (callback(new caInvalidFieldError('module')));

	if (!props['stat'])
		return (callback(new caInvalidFieldError('stat')));

	/*
	 * Check whether the base metric exists in the user's profile.  If not,
	 * we act just as though it didn't exist at all.
	 */
	metric = request.pset.baseMetric(props['module'], props['stat']);
	if (!metric)
		return (callback(new caInvalidFieldError('module.stat',
		    props['module'] + '.' + props['stat'],
		    'not a valid module/stat pair')));

	request.metric = metric;

	/*
	 * "decomposition" is optional.  If it comes in as a string, convert it
	 * to an empty array to match our canonical form.
	 */
	if (!props['decomposition'] || props['decomposition'] === '')
		props['decomposition'] = [];
	else if (typeof (props['decomposition']) == typeof (''))
		props['decomposition'] = props['decomposition'].split(',');

	/*
	 * "predicate" is also optional.  If it comes in as a string, it should
	 * be reparsed, since the canonical representation is always an object
	 * but clients may pass in a JSON (string) representation.
	 */
	if (!props['predicate'])
		props['predicate'] = {};
	else if (typeof (props['predicate']) == typeof ('')) {
		try {
			props['predicate'] = JSON.parse(props['predicate']);
		} catch (ex) {
			return (callback(new caInvalidFieldError('predicate',
			    props['predicate'], 'invalid JSON: ' +
			    ex.message)));
		}
	}

	/*
	 * Validate the predicate syntactically. We do this before validating
	 * whether the decomposition and predicate use valid fields because the
	 * predicate must have correct form to even extract the fields from it.
	 */
	try {
		mod_capred.caPredValidateSyntax(props['predicate']);
	} catch (ex) {
		return (callback(ex));
	}

	/*
	 * Now that we've got a valid base metric and predicate structure, check
	 * that the user-specified fields are valid.
	 */
	mfields = metric.fields();
	fieldarities = {};
	for (ii = 0; ii < mfields.length; ii++)
		fieldarities[mfields[ii]] = this.fieldArity(mfields[ii]);
	request.fields = fields = props['decomposition'].concat(
	    mod_capred.caPredFields(props['predicate']));
	for (ii = 0; ii < fields.length; ii++) {
		if (!(fields[ii] in fieldarities))
			return (callback(new caInvalidFieldError('field',
			    fields[ii], 'no such field for specified metric')));
	}

	try {
		mod_capred.caPredValidateSemantics(fieldarities,
		    props['predicate']);
	} catch (ex) {
		return (callback(ex));
	}

	/*
	 * Validate the decomposition fields and fill in the value-* members.
	 */
	try {
		request.arity = caInstArity(fieldarities,
		    props['decomposition']);
		props['value-dimension'] = request.arity['dimension'];
		props['value-arity'] = request.arity['arity'];
	} catch (ex) {
		return (callback(ex));
	}

	props['crtime'] = new Date().getTime();

	/*
	 * Validate the "granularity" property, which must be a positive integer
	 * that's either 1 or divisible by the minimum granularity that's
	 * greater than one.
	 */
	if (!('granularity' in props))
		props['granularity'] = cai_granularity_default;

	props['granularity'] = parseInt(props['granularity'], 10);

	if (isNaN(props['granularity']) || props['granularity'] < 1)
		return (callback(new caInvalidFieldError('granularity',
		    props['granularity'], 'not a positive integer')));

	if (props['granularity'] != 1 &&
	    props['granularity'] % mod_ca.ca_granularity_min != 0)
		return (callback(new caInvalidFieldError('granularity',
		    props['granularity'], 'must be divisible by %d',
		    mod_ca.ca_granularity_min)));

	/*
	 * Fill in available transformations.
	 */
	props['transformations'] = caInstTransformations(fieldarities,
	    this.cif_transformations, props);

	/*
	 * Validate the optional mutable fields.
	 */
	if (!('enabled' in props))
		props['enabled'] = 'true';
	if (!('retention-time' in props))
		props['retention-time'] = cai_retain_default;
	if (!('idle-max' in props))
		props['idle-max'] = cai_idle_max_default;
	if (!('persist-data' in props))
		props['persist-data'] = 'false';

	try {
		caInstValidateMutableFields(props,
		    request.cust_id === undefined);
	} catch (ex) {
		return (callback(ex));
	}

	request.tk.step('validation');

	return (callback(null, request));
};

caInstrumentationFactory.prototype.fieldArity = function (field)
{
	return (this.cif_metadata.fieldArity(field));
};

/*
 * [private] Create Stage: Check MAPI for containers
 */
caInstrumentationFactory.prototype.stageCheckContainers = function (request,
    callback)
{
	var custid;

	custid = request.cust_id;
	request.inst_id = this.cif_nextid(custid);

	if (custid === undefined) {
		callback(null, request);
		return;
	}

	if (!this.cif_mapi) {
		callback(new caError(ECA_REMOTE, null,
		    'MAPI is not configured'));
		return;
	}

	this.cif_mapi.listContainers(custid, function (err, zonesbyhost) {
		if (err)
			return (callback(new caError(ECA_REMOTE, err,
			    'failed to list customer zones for %s', custid)));

		request.zonesbyhost = zonesbyhost;
		request.tk.step('list mapi containers');
		return (callback(null, request));
	});
};

/*
 * [private] Returns an available aggregator.  We currently choose a random
 * available aggregator with the expectation that this will spread load around
 * and minimize the likelihood of becoming corked on a single bad aggregator.
 */
caInstrumentationFactory.prototype.pickAggregator = function ()
{
	var hostname, aggregator, rand;
	var aggregators = [];

	for (hostname in this.cif_aggregators) {
		aggregator = this.cif_aggregators[hostname];
		if (aggregator.cag_ninsts >= cai_agg_maxinsts)
			continue;

		/*
		 * We may have a record for this aggregator without any of the
		 * details if it's being used to aggregate an instrumentation we
		 * restored from the stash but we haven't yet actually heard
		 * from it.  In that case, we'll re-enable the aggregator when
		 * we hear from it next.
		 */
		if (!aggregator.cag_routekey)
			continue;

		aggregators.push(aggregator);
	}

	if (aggregators.length === 0)
		return (undefined);

	rand = Math.floor(Math.random() * aggregators.length);
	return (aggregators[rand]);
};

/*
 * [private] Create stage: Figure out which hosts we should attempt to contact
 * for instrumentation
 */
caInstrumentationFactory.prototype.stageCheckHosts = function (request,
    callback)
{
	var hosts, hostname;

	hosts = request.zonesbyhost || this.cif_instrumenters;
	request.hosts = {};
	request.properties['nsources'] = 0;

	for (hostname in hosts) {
		/*
		 * It's possible that we're looking at a compute node with
		 * customer zones whose instrumenter (if it even has one) has
		 * never reported its existence to us.  For now, we simply
		 * ignore all of the zones on such nodes.
		 */
		if (!(hostname in this.cif_instrumenters))
			continue;

		if (!(this.cif_metrics.supports(request.metric,
		    request.fields, hostname))) {
			this.cif_log.dbg('skipping instrumenter %s: doesn\'t ' +
			    'support this metric', hostname);
			continue;
		}

		request.hosts[hostname] = true;
		request.properties['nsources']++;
	}

	request.tk.step('check hosts');
	callback(null, request);
};

/*
 * [private] Create Stage: Choose and enable an aggregator.
 */
caInstrumentationFactory.prototype.stageEnableAggregator = function (request,
    callback)
{
	var aggregator, fqid;

	aggregator = this.pickAggregator();

	if (!aggregator)
		return (callback(new caError(ECA_NORESOURCE, null,
		    'no aggregators available')));

	request.inst = new caInstrumentation({
		aggregator: aggregator,
		cust_id: request.cust_id,
		inst_id: request.inst_id,
		properties: request.properties,
		uri_base: this.cif_uri_base,
		zonesbyhost: request.zonesbyhost
	});

	fqid = request.inst.fqid();
	this.cif_log.dbg('creating instrumentation %s on aggregator %s', fqid,
	    aggregator.cag_hostname);
	request.routekey = mod_cap.caRouteKeyForInst(fqid);
	request.tk.step('pick aggregator');

	this.cif_cap.cmdEnableAgg(aggregator.cag_routekey, fqid,
	    request.routekey, request.inst.properties(), cai_timeout_aggenable,
	    function (err, okay) {
		if (err) {
			/* XXX try another aggregator? */
			return (callback(new caError(ECA_NORESOURCE,
			    err, 'failed to enable aggregator')));
		}

		ASSERT(okay);
		aggregator.cag_insts[fqid] = true;
		aggregator.cag_ninsts++;
		request.tk.step('enable aggregator');
		return (callback(null, request));
	    });

	return (undefined);
};

/*
 * [private] Create Stage: Enable all instrumenters.
 */
caInstrumentationFactory.prototype.stageEnableInstrumenters = function (request,
    callback)
{
	var hostname, instrumenter, log;
	var nleft, nenabled, errors, done;
	var factory = this;

	log = this.cif_log;
	nleft = 0;
	nenabled = 0;
	errors = [];

	done = function () {
		var ii;

		if (errors.length !== 0) {
			for (ii = 0; ii < errors.length; ii++) {
				log.warn('failed to enable "%s" on host ' +
				    '"%s": %s',  request.inst.fqid(),
				    errors[ii].hostname, errors[ii].error);
				request.warnings.push(caSprintf('failed to ' +
				    'enable instrumenter: %s',
				    errors[ii].error));
			}

		}

		request.tk.step('enable instrumenters');
		return (callback(null, request));
	};

	if (caIsEmpty(request.hosts)) {
		factory.destroy(request.inst, caNoop);
		callback(new caError(ECA_INVAL, null,
		    'found zero hosts to instrument'));
		return;
	}

	++nleft;

	for (hostname in request.hosts) {
		instrumenter = this.cif_instrumenters[hostname];

		++nleft;
		++nenabled;
		this.enableInstrumenter(request.inst, instrumenter,
		    function (err) {
			var fqid = request.inst.fqid();

			if (err) {
				errors.push({ hostname: hostname, error: err });
				if (err instanceof caError &&
				    err.code() == ECA_TIMEDOUT) {
					instrumenter.ins_insts[fqid] = true;
				}
			} else {
				instrumenter.ins_insts[fqid] = true;
				instrumenter.ins_ninsts++;
			}

			if (--nleft === 0)
				done();
		    });
	}

	if (--nleft === 0)
		done();

	ASSERT(nenabled > 0);
};

/*
 * [private] Create Stage: Finish creating the instrumentation.
 */
caInstrumentationFactory.prototype.stageComplete = function (request, callback)
{
	callback(null, {
	    inst: request.inst,
	    warnings: request.warnings
	});

	this.cif_log.dbg('instn "%s" create: %s', request.inst.fqid(),
	    request.tk);
};

/*
 * Representation of an instrumentation.  Each instrumentation has several
 * properties, most of them immutable, which are documented in the HTTP API
 * documentation.
 *
 * The constructor's "conf" argument must specify the following members:
 *
 *	properties	the properties for this instrumentation
 *
 *	cust_id		the customer id to which this instrumentation is scoped
 *
 *	inst_id		the instrumentation's identifier
 *
 *	aggregator	aggregator for this instrumentation
 *
 *	uri_base	base of instrumentation URIs
 *
 *	zonesbyhost	if specified, maps instrumenter hostnames to list of
 *			zones to instrument on that system
 */
function caInstrumentation(conf)
{
	this.ci_custid = conf.cust_id;
	ASSERT(conf.inst_id);
	this.ci_instid = conf.inst_id;
	this.ci_fqid = mod_ca.caQualifiedId(conf.cust_id, conf.inst_id);
	ASSERT(conf.uri_base);
	this.ci_uri_base = conf.uri_base;

	ASSERT(conf.aggregator);
	this.ci_aggregator = conf.aggregator;

	if (conf.zonesbyhost)
		this.ci_zonesbyhost = conf.zonesbyhost;

	ASSERT(conf.properties);
	this.loadProperties(conf.properties);
}

/*
 * [private] Load properties from the given object.
 */
caInstrumentation.prototype.loadProperties = function (props)
{
	var fields, defaults, ii, uris, uri;
	var custid, instid, baseuri;

	this.ci_props = {};

	fields = [ 'module', 'stat', 'predicate', 'decomposition',
	    'value-dimension', 'value-arity', 'enabled', 'retention-time',
	    'idle-max', 'transformations', 'nsources', 'granularity',
	    'persist-data', 'crtime' ];

	defaults = {
	    'crtime': 0,
	    'persist-data': false
	};

	for (ii = 0; ii < fields.length; ii++) {
		if (!(fields[ii] in props)) {
			ASSERT(fields[ii] in defaults);
			this.ci_props[fields[ii]] = defaults[fields[ii]];
			continue;
		}

		this.ci_props[fields[ii]] = props[fields[ii]];
	}

	baseuri = this.ci_uri_base;
	custid = this.ci_custid;
	instid = this.ci_instid;
	uri = caSprintf('%s%s%s/%s', baseuri,
	    (custid ? cai_http_uri_cust + '/' + custid : ''),
	    cai_http_uri_inst, instid);
	this.ci_props['uri'] = uri;
	this.ci_props['id'] = instid.toString();

	uris = [];
	if (this.ci_props['value-arity'] == mod_ca.ca_arity_numeric) {
		uris.push({
		    uri: uri + cai_http_uri_heatmap_image,
		    name: 'value_heatmap'
		});
		uris.push({
		    uri: uri + cai_http_uri_heatmap_details,
		    name: 'details_heatmap'
		});
	}

	uris.push({ uri: uri + cai_http_uri_raw, name: 'value_raw' });
	this.ci_props['uris'] = uris;
};

caInstrumentation.prototype.custid = function ()
{
	return (this.ci_custid);
};

caInstrumentation.prototype.instid = function ()
{
	return (this.ci_instid);
};

caInstrumentation.prototype.properties = function ()
{
	return (this.ci_props);
};

caInstrumentation.prototype.fqid = function ()
{
	return (this.ci_fqid);
};

caInstrumentation.prototype.aggregator = function ()
{
	return (this.ci_aggregator);
};

caInstrumentation.prototype.zonesbyhost = function (host)
{
	if (!this.ci_zonesbyhost)
		return (undefined);

	if (!(host in this.ci_zonesbyhost))
		return ([]);

	return (this.ci_zonesbyhost[host]);
};

caInstrumentation.prototype.rawzonesbyhost = function ()
{
	return (this.ci_zonesbyhost);
};

/*
 * Given a the field types for a metric and the 'decomposition' fields of a
 * potential instrumentation, validate the decomposition fields and return the
 * "arity" of one of the resulting data points.  This is specified as an object
 * with the following member:
 *
 *	dimension	Describes the dimensionality of each datum as an
 *			integer.  For simple scalar metrics, the dimension is 1.
 *			The dimensionality increases with each decomposition.
 *
 *	arity		Describes the datum itself.  If dimension is 1, then
 *			type is always 'scalar'.  If any decompositions use a
 *			numeric field (e.g., latency), then type is
 *			'numeric-decomposition'.  Otherwise, type is
 *			'discrete-decomposition'.
 *
 * Combined, this information allows clients to know whether to visualize the
 * result as a simple line graph, a line graph with multiple series, or a
 * heatmap.  For examples:
 *
 *	METRIC				DIM	type		VISUAL
 *	i/o ops				1	scalar		line
 *	i/o ops by disk			2	discrete 	multi-line
 *	i/o ops by latency		2	numeric		heatmap
 *	i/o ops by latency and disk	3	numeric		heatmap
 */
function caInstArity(fieldarities, decomp)
{
	var field, type, ctype, ii;
	var ndiscrete = 0;
	var nnumeric = 0;

	type = decomp.length === 0 ? mod_ca.ca_arity_scalar :
	    mod_ca.ca_arity_discrete;

	for (ii = 0; ii < decomp.length; ii++) {
		field = decomp[ii];
		ASSERT(field in fieldarities);
		ctype = fieldarities[field];

		if (ctype == mod_ca.ca_field_arity_numeric) {
			type = mod_ca.ca_arity_numeric;
			nnumeric++;
		} else {
			ndiscrete++;
		}
	}

	if (ndiscrete > 1)
		throw (new caInvalidFieldError('decomposition', decomp,
		    'more than one discrete decomposition specified'));

	if (nnumeric > 1)
		throw (new caInvalidFieldError('decomposition', decomp,
		    'more than one numeric decomposition specified'));

	return ({ dimension: decomp.length + 1, arity: type });
}

/*
 * Validates the mutable fields of an instrumentation.
 * XXX convert caHttpParam to use caInvalidFieldError and make this function
 * much simpler.
 */
function caInstValidateMutableFields(props, privileged)
{
	var retain, idle;

	if ('enabled' in props) {
		if (props['enabled'] !== 'true')
			throw (new caInvalidFieldError('enabled',
			    props['enabled'], 'unsupported value'));

		props['enabled'] = true;
	}

	if ('retention-time' in props) {
		retain = parseInt(props['retention-time'], 10);

		if (isNaN(retain))
			throw (new caInvalidFieldError('retention-time',
			    props['retention-time'], 'not a number'));

		if (retain < cai_retain_min)
			throw (new caInvalidFieldError('retention-time',
			    props['retention-time'], 'minimum is %s',
			    cai_retain_min));

		if (retain / props['granularity'] > cai_datapoints_max)
			throw (new caInvalidFieldError('retention-time',
			    props['retention-time'],
			    'maximum for granularity "%s" is %s',
			    props['granularity'], cai_datapoints_max *
			    props['granularity']));

		props['retention-time'] = retain;
	}

	if ('idle-max' in props) {
		idle = parseInt(props['idle-max'], 10);

		if (isNaN(idle))
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'not a number'));

		if (idle < cai_idle_max_min)
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'minimum is %s',
			    cai_idle_max_min));

		if (idle > cai_idle_max_max)
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'maximum is %s',
			    cai_idle_max_max));

		if (idle === 0 && !privileged)
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'zero not allowed'));

		props['idle-max'] = idle;
	}

	if ('persist-data' in props) {
		if (props['persist-data'] === 'true')
			props['persist-data'] = true;
		else if (props['persist-data'] === 'false')
			props['persist-data'] = false;
		else
			throw (new caInvalidFieldError('persist-data',
			    props['persist-data'], 'must be a boolean'));
	}

	return ([ 'enabled', 'retention-time', 'idle-max', 'persist-data' ]);
}

/*
 * Fill in available transformations based on the specified metric and the
 * instrumentation defined by "props".
 */
function caInstTransformations(fieldarities, transformations, props)
{
	var ret = {};
	var ii, tname, tfields, fname, transform;

	for (tname in transformations) {
		transform = transformations[tname];
		tfields = transform['fields'];
		for (ii = 0; ii < props['decomposition'].length; ii++) {
			fname = props['decomposition'][ii];
			if (caArrayContains(tfields, fname) && !(tname in ret))
				ret[tname] = transform;
		}
	}

	return (ret);
}
